import { useState } from 'react';
import { copyText } from './clipboard.js';
import { Modal } from './ui.jsx';

export default function InviteDialog({ link, code, onClose }) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  async function retry() {
    setCopying(true);
    try { setCopied(await copyText(link)); }
    finally { setCopying(false); }
  }
  return <Modal title="邀请朋友" onClose={onClose}>
    <span className="eyebrow">INVITE YOUR FRIENDS</span>
    <h2>邀请朋友入座</h2>
    <p role="status">{copied ? '邀请链接已复制，发给朋友即可加入。' : '浏览器未能自动复制。请选中下面的完整链接，长按或按 Ctrl+C（Mac：⌘C）复制。'}</p>
    <label className="field-label" htmlFor="invite-link">邀请链接</label>
    <input id="invite-link" className="invite-link" value={link} readOnly autoFocus
      onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()}/>
    <p className="invite-code">也可以让朋友打开同一个网站，输入房间码：<strong>{code}</strong></p>
    <div className="dialog-actions">
      <button className="button secondary" onClick={onClose}>关闭</button>
      <button className="button primary" disabled={copying} onClick={retry}>{copying ? '复制中…' : '重试复制链接'}</button>
    </div>
  </Modal>;
}
