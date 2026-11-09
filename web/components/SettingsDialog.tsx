import React, { useEffect, useState } from 'react';
import { api, getApiKey, setApiKey } from '../api';
import { IconX } from '../icons';

export const SettingsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [key, setKey] = useState(getApiKey());
  const [serverKey, setServerKey] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .config()
      .then((c) => setServerKey(c.serverKey))
      .catch(() => setServerKey(false));
  }, []);

  const mode = key ? 'Dùng API key của bạn' : serverKey ? 'Dùng GEMINI_API_KEY trên server' : 'Chế độ Demo (clip giả lập bằng Remotion, miễn phí)';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Cài đặt</h3>
          <button className="icon-btn" onClick={onClose}>
            <IconX />
          </button>
        </div>
        <label className="field">
          <span>Gemini API key (Google AI Studio)</span>
          <input type="password" placeholder="AIza…" value={key} onChange={(e) => setKey(e.target.value.trim())} />
        </label>
        <p className="muted small">
          Key được lưu trong trình duyệt này và gửi tới server của bạn để gọi Veo / Gemini. Lấy key tại aistudio.google.com/apikey. Việc tạo video
          bằng Veo có tính phí theo tài khoản Google của bạn.
        </p>
        <div className="status-pill">Trạng thái: {mode}</div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setKey('')}>
            Xóa key
          </button>
          <button
            className="btn primary"
            onClick={() => {
              setApiKey(key);
              onClose();
            }}
          >
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
};
