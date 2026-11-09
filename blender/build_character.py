"""
Flow Studio — build a stylised, rigged 3D character in Blender and export it as GLB.

Run it any of these ways:
  * mcp-for-blender: ask Claude to run this file with the `execute_blender_code` tool
    (paste the file content), optionally after changing CONFIG below.
  * Blender UI: Scripting tab > open this file > Run Script.
  * Command line: blender --background --python blender/build_character.py -- out.glb

The armature uses the bone names Flow Studio's motion retargeting understands
(Hips, Spine, Chest, Neck, Head, LeftUpperArm, ... plus *Tip / *Toe end bones),
so the exported GLB can be loaded directly as a "Nhân vật 3D" on the timeline.
Mixamo rigs (mixamorig:Hips, LeftArm, LeftForeArm, ...) are understood as well.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

CONFIG = {
    "name": "FlowCharacter",
    "skin": (0.93, 0.72, 0.58),
    "shirt": (0.95, 0.55, 0.20),   # hoodie
    "pants": (0.16, 0.20, 0.30),
    "shoes": (0.95, 0.95, 0.93),
    "hair": (0.10, 0.07, 0.06),
    "eyes": (0.08, 0.06, 0.05),
    "output": os.path.join(os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd(), "..", "assets", "characters", "flow-character.glb"),
}

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if argv:
    CONFIG["output"] = argv[0]

# ---------------------------------------------------------------- helpers
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgb, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    lin = tuple(c ** 2.2 for c in rgb)  # CONFIG colours are sRGB, Blender wants linear
    bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def select_only(*objs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


# Character proportions (metres, Blender Z-up, facing -Y, character's left = +X).
J = {
    "pelvis": (0, 0, 0.98), "spine": (0, 0, 1.12), "chest": (0, 0, 1.30), "neck": (0, 0, 1.47), "head": (0, 0, 1.55),
    "l_sh": (0.17, 0, 1.42), "l_el": (0.43, 0, 1.42), "l_wr": (0.67, 0, 1.42), "l_hand": (0.77, 0, 1.42),
    "l_hip": (0.10, 0, 0.94), "l_kn": (0.11, 0, 0.53), "l_an": (0.12, 0, 0.10), "l_toe": (0.12, -0.17, 0.04),
}
for k in list(J):
    if k.startswith("l_"):
        x, y, z = J[k]
        J["r_" + k[2:]] = (-x, y, z)


# ---------------------------------------------------------------- body (skin modifier)
def build_body(mats):
    # Skeleton graph of the body with a radius per vertex; the Skin modifier wraps it in a smooth mesh.
    nodes = [
        ("pelvis", 0.15), ("spine", 0.14), ("chest", 0.17), ("neck", 0.055),
        ("l_sh", 0.075), ("l_el", 0.055), ("l_wr", 0.042), ("l_hand", 0.045),
        ("r_sh", 0.075), ("r_el", 0.055), ("r_wr", 0.042), ("r_hand", 0.045),
        ("l_hip", 0.095), ("l_kn", 0.07), ("l_an", 0.05), ("l_toe", 0.05),
        ("r_hip", 0.095), ("r_kn", 0.07), ("r_an", 0.05), ("r_toe", 0.05),
    ]
    edges = [
        ("pelvis", "spine"), ("spine", "chest"), ("chest", "neck"),
        ("chest", "l_sh"), ("l_sh", "l_el"), ("l_el", "l_wr"), ("l_wr", "l_hand"),
        ("chest", "r_sh"), ("r_sh", "r_el"), ("r_el", "r_wr"), ("r_wr", "r_hand"),
        ("pelvis", "l_hip"), ("l_hip", "l_kn"), ("l_kn", "l_an"), ("l_an", "l_toe"),
        ("pelvis", "r_hip"), ("r_hip", "r_kn"), ("r_kn", "r_an"), ("r_an", "r_toe"),
    ]
    idx = {n: i for i, (n, _) in enumerate(nodes)}
    mesh = bpy.data.meshes.new("Body")
    mesh.from_pydata([J[n] for n, _ in nodes], [(idx[a], idx[b]) for a, b in edges], [])
    body = link(bpy.data.objects.new("Body", mesh))
    skin = body.modifiers.new("Skin", "SKIN")
    skin.use_smooth_shade = True
    for i, (_, r) in enumerate(nodes):
        sv = mesh.skin_vertices[0].data[i]
        sv.radius = (r, r * (0.8 if nodes[i][0] in ("pelvis", "spine", "chest") else 1.0))
    mesh.skin_vertices[0].data[idx["pelvis"]].use_root = True
    sub = body.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = 2
    select_only(body)
    bpy.ops.object.modifier_apply(modifier="Skin")
    bpy.ops.object.modifier_apply(modifier="Subsurf")
    bpy.ops.object.shade_smooth()

    # Clothing by region: shoes, pants, hoodie, skin for hands and neck.
    for m in ("skin", "shirt", "pants", "shoes"):
        body.data.materials.append(mats[m])
    order = {"skin": 0, "shirt": 1, "pants": 2, "shoes": 3}
    for poly in body.data.polygons:
        c = body.matrix_world @ poly.center
        ax = abs(c.x)
        if c.z < 0.16:
            poly.material_index = order["shoes"]
        elif c.z < 0.93 and ax < 0.25:
            poly.material_index = order["pants"]
        elif ax > 0.64:
            poly.material_index = order["skin"]  # hands
        elif c.z > 1.46:
            poly.material_index = order["skin"]  # neck
        else:
            poly.material_index = order["shirt"]
    return body


# ---------------------------------------------------------------- head (stylised)
def build_head(mats):
    parts = []
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=0.135, location=(0, 0, 1.66))
    head = bpy.context.active_object
    head.scale = (1.0, 0.95, 1.12)
    head.data.materials.append(mats["skin"])
    bpy.ops.object.shade_smooth()
    parts.append(head)

    # Hair: upper shell of a slightly larger sphere, shifted back.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=0.145, location=(0, 0.012, 1.685))
    hair = bpy.context.active_object
    hair.scale = (1.04, 1.0, 1.08)
    bm = bmesh.new()
    bm.from_mesh(hair.data)
    cut = [v for v in bm.verts if v.co.z < -0.02 or (v.co.y < -0.06 and v.co.z < 0.07)]
    bmesh.ops.delete(bm, geom=cut, context="VERTS")
    bm.to_mesh(hair.data)
    bm.free()
    sol = hair.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.012
    select_only(hair)
    bpy.ops.object.modifier_apply(modifier="Solid")
    hair.data.materials.append(mats["hair"])
    bpy.ops.object.shade_smooth()
    parts.append(hair)

    # Eyes, brows, nose, ears.
    for sx in (1, -1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=0.018, location=(0.045 * sx, -0.118, 1.675))
        eye = bpy.context.active_object
        eye.scale = (1, 0.6, 1.25)
        eye.data.materials.append(mats["eyes"])
        bpy.ops.object.shade_smooth()
        parts.append(eye)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0.047 * sx, -0.122, 1.712))
        brow = bpy.context.active_object
        brow.scale = (0.036, 0.008, 0.007)
        brow.rotation_euler = (0, -0.18 * sx, 0)
        brow.data.materials.append(mats["hair"])
        parts.append(brow)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=0.028, location=(0.133 * sx, 0.0, 1.66))
        ear = bpy.context.active_object
        ear.scale = (0.45, 0.8, 1.0)
        ear.data.materials.append(mats["skin"])
        bpy.ops.object.shade_smooth()
        parts.append(ear)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=0.016, location=(0, -0.128, 1.645))
    nose = bpy.context.active_object
    nose.data.materials.append(mats["skin"])
    bpy.ops.object.shade_smooth()
    parts.append(nose)

    # Hood collar around the neck.
    bpy.ops.mesh.primitive_torus_add(major_radius=0.1, minor_radius=0.035, location=(0, 0.01, 1.455))
    hood = bpy.context.active_object
    hood.scale = (1.15, 1.0, 0.8)
    hood.data.materials.append(mats["shirt"])
    bpy.ops.object.shade_smooth()
    parts.append(hood)

    select_only(*parts)
    bpy.context.view_layer.objects.active = head
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.join()
    head.name = "Head"
    # Slightly oversized head for a friendly, stylised look (scaled around the neck).
    pivot = Vector((0, 0, 1.53))
    for v in head.data.vertices:
        if v.co.z > 1.51:  # leave the hood collar where it is
            v.co = pivot + (v.co - pivot) * 1.12
    return head


# ---------------------------------------------------------------- armature
BONES = [
    # name, head joint, tail joint, parent
    ("Hips", "pelvis", "spine", None),
    ("Spine", "spine", "chest", "Hips"),
    ("Chest", "chest", "neck", "Spine"),
    ("Neck", "neck", "head", "Chest"),
    ("Head", "head", (0, 0, 1.80), "Neck"),
    ("HeadTop", (0, 0, 1.80), (0, 0, 1.84), "Head"),
    ("LeftUpperArm", "l_sh", "l_el", "Chest"), ("LeftLowerArm", "l_el", "l_wr", "LeftUpperArm"),
    ("LeftHand", "l_wr", "l_hand", "LeftLowerArm"), ("LeftHandTip", "l_hand", (0.83, 0, 1.42), "LeftHand"),
    ("RightUpperArm", "r_sh", "r_el", "Chest"), ("RightLowerArm", "r_el", "r_wr", "RightUpperArm"),
    ("RightHand", "r_wr", "r_hand", "RightLowerArm"), ("RightHandTip", "r_hand", (-0.83, 0, 1.42), "RightHand"),
    ("LeftUpperLeg", "l_hip", "l_kn", "Hips"), ("LeftLowerLeg", "l_kn", "l_an", "LeftUpperLeg"),
    ("LeftFoot", "l_an", "l_toe", "LeftLowerLeg"), ("LeftToe", "l_toe", (0.12, -0.22, 0.04), "LeftFoot"),
    ("RightUpperLeg", "r_hip", "r_kn", "Hips"), ("RightLowerLeg", "r_kn", "r_an", "RightUpperLeg"),
    ("RightFoot", "r_an", "r_toe", "RightLowerLeg"), ("RightToe", "r_toe", (-0.12, -0.22, 0.04), "RightFoot"),
]


def build_armature():
    arm_data = bpy.data.armatures.new("Rig")
    rig = link(bpy.data.objects.new("Rig", arm_data))
    select_only(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    for name, h, t, parent in BONES:
        b = eb.new(name)
        b.head = Vector(J[h] if isinstance(h, str) else h)
        b.tail = Vector(J[t] if isinstance(t, str) else t)
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


# ---------------------------------------------------------------- build
def build():
    reset_scene()
    mats = {k: material(k.capitalize(), CONFIG[k], 0.75 if k in ("shirt", "pants") else 0.5) for k in ("skin", "shirt", "pants", "shoes", "hair", "eyes")}
    mats["eyes"].node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.15
    body = build_body(mats)
    head = build_head(mats)
    rig = build_armature()

    # Body: automatic (heat) weights. Head: rigid on the Head bone.
    select_only(body, rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    vg = head.vertex_groups.new(name="Head")
    vg.add([v.index for v in head.data.vertices], 1.0, "REPLACE")
    mod = head.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    head.parent = rig

    # One skinned mesh.
    select_only(body, head)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = CONFIG["name"]

    out = os.path.abspath(CONFIG["output"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    select_only(body, rig)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_animations=False,
        export_yup=True,
        export_apply=False,
    )
    print(f"Exported {out} ({os.path.getsize(out) // 1024} KB, {len(body.data.vertices)} vertices)")
    return out


build()
