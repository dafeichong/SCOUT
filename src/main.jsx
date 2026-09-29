import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import Game from './Game.jsx';
import { Card, Modal } from './ui.jsx';
import './style.css';

const socket = io({ autoConnect: false });
function App() {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState(localStorage.getItem('scout-name') || '');
  const [code, setCode] = useState(new URLSearchParams(location.search).get('room')?.toUpperCase() || '');
  const [rules, setRules] = useState(false);
  const roomRef = useRef(null);
  const pending = useRef(false);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    // Optional browser agent access uses exactly the same private state as this UI.
    if (!document.modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(document.modelContext.registerTool({
        name: 'read_scout_table', title: '查看当前 SCOUT 牌局',
        description: 'Read the visible SCOUT table, including only this player’s hand. Does not perform any action.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: input => {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.');
          return roomRef.current ?? { phase: 'home' };
        },
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* Browser support is optional. */ }
    return () => lifecycle.abort();
  }, []);
  useEffect(() => {
    const state = value => { roomRef.current = value; setRoom(value); };
    socket.on('room:state', state);
    socket.on('connect', () => { setConnected(true); setError(''); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', e => setError(e.message === 'xhr poll error' ? '暂时无法连接，正在重试…' : e.message));
    fetch('/api/session').then(r => { if (!r.ok) throw new Error('连接失败，请刷新重试。'); socket.connect(); }).catch(e => setError(e.message));
    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }, []);
  async function command(type, payload = {}) {
    if (!socket.connected || pending.current) return false;
    pending.current = true;
    setBusy(true); setError('');
    try {
      const response = await socket.timeout(8000).emitWithAck('room:command', { type, payload, version: roomRef.current?.version });
      if (!response.ok) throw new Error(response.error);
      return true;
    } catch (e) { setError(e.message === 'operation has timed out' ? '网络响应超时，请检查牌局状态后重试。' : e.message); return false; }
    finally { pending.current = false; setBusy(false); }
  }
  function enter(type) { localStorage.setItem('scout-name', name); command(type, { name, code: code.trim().toUpperCase() }); }
  return <div className={`app-shell ${room ? 'in-room' : ''}`}>
    <header className="topbar"><a className="wordmark" href="/" aria-label="SCOUT 首页">SCO<span>U</span>T<i>♦</i></a><div className="header-right"><span className={`connection ${connected ? 'live' : ''}`}>{connected ? '已连接' : '连接中'}</span><button className="text-button" onClick={() => setRules(true)}>玩法说明 <span>?</span></button></div></header>
    {error && <div className="toast error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="关闭提示">×</button></div>}
    {notice && !error && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}
    {!room ? <main className="welcome">
      <section className="welcome-art"><span className="eyebrow">THE SHOW IS YOURS</span><h1>朋友就位，<br/><em>好戏开场。</em></h1><p>手牌不能重排，好牌可以招募。<br/>用一场精彩的表演，赢下今晚的掌声。</p><div className="hero-cards" aria-hidden="true">{[{value:3,other:8},{value:4,other:9},{value:5,other:2}].map((c,i)=><Card key={i} card={c}/>)}</div><div className="game-facts"><span>02—05 <small>玩家</small></span><span>20 <small>分钟</small></span><span>∞ <small>种好戏</small></span></div></section>
      <section className="entry-panel"><div className="ticket-label">今晚的入场券 <span>ADMIT ONE</span></div><div className="entry-body"><h2>入座，开始一局</h2><p className="muted">无需注册，和朋友分享房间即可开玩。</p><label htmlFor="nickname">你的昵称</label><input id="nickname" value={name} maxLength={16} onChange={e=>setName(e.target.value)} placeholder="大家怎么称呼你？" autoComplete="nickname" onKeyDown={e=>{if(e.key==='Enter' && name.trim())enter(code?'join':'create');}}/><button className="button primary full" disabled={!connected || busy || !name.trim()} onClick={()=>enter('create')}>创建新房间 <span>＋</span></button><div className="divider"><span>或加入朋友的房间</span></div><label htmlFor="room-code">6 位房间码</label><div className="join-row"><input id="room-code" value={code} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6))} placeholder="例如 K7M2PX" maxLength={6} autoComplete="off" onKeyDown={e=>{if(e.key==='Enter' && code.length===6 && name.trim())enter('join');}}/><button className="button secondary" disabled={!connected || busy || !name.trim() || code.length!==6} onClick={()=>enter('join')}>加入</button></div></div><div className="ticket-footer"><span>✦</span> 每一次招募，都可能改变下一场表演。</div></section>
    </main> : <Game room={room} command={command} busy={busy} connected={connected} notify={setNotice}/>}
    <footer className="footer"><span>SCOUT / 好戏开场</span><span>好友私桌 · 非官方数字实现</span></footer>
    {rules && <Modal title="玩法说明" onClose={()=>setRules(false)}><span className="eyebrow">HOW TO PLAY</span><h2>一场好戏，三种选择。</h2><p>手牌顺序不能改变。每轮开局可以整手旋转，确认后锁定。</p><h3>01 / 出牌</h3><p>打出手中相邻的同数或连续数字。先比较张数，再比较类型（同数大于顺子），最后比较数值。压过的桌面牌每张得 1 分。</p><h3>02 / 招募</h3><p>拿桌面最左或最右的一张，选择任一方向，插入手牌任意位置。原出牌者得 1 分。</p><h3>03 / 招募＋出牌</h3><p>每轮一次，招募后立即出牌，压过招募后剩下的桌面组合。</p><h3>结束与计分</h3><p>有人出完牌，或其他人连续都只招募，本轮结束。得分＝收取的牌＋招募筹码－剩余手牌；无人压过的出牌者免扣手牌分。最后留在桌面的组合不计分。人数等于轮数，总分最高获胜，同分共享胜利。</p><h3>双人模式</h3><p>每人 11 张牌、3 枚招募筹码。招募消耗自己的筹码，不给对方加分；招募后仍然是自己的回合。无法出牌且无筹码，或有人出完手牌，本轮结束。剩余招募筹码每枚计 1 分。共 2 轮，没有招募＋出牌。</p></Modal>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
