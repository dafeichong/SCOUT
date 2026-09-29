import { useEffect, useState } from 'react';
import { beats, describeSet, legalShows } from '../shared/rules.js';
import { Card, Modal, chooseRange } from './ui.jsx';

const pad = n => String(n).padStart(2, '0');
const signed = n => n > 0 ? `+${n}` : String(n);
function Hand({ cards, range, setRange, disabled = false, small = false }) {
  return <div className={`hand-scroll ${small ? 'compact' : ''}`}><div className="hand-cards">{cards.map((card, i) => <Card key={card.id} card={card} index={i} small={small} selected={!!range && i >= range[0] && i <= range[1]} disabled={disabled} onClick={setRange ? () => setRange(chooseRange(range, i)) : undefined}/>)}</div></div>;
}

function ScoutDialog({ room, mode, command, busy, onClose }) {
  const me = room.players.find(p => p.id === room.you);
  const [edge, setEdge] = useState('left');
  const [flip, setFlip] = useState(false);
  const [insertAt, setInsertAt] = useState(me.hand.length);
  const [range, setRange] = useState(null);
  const combo = mode === 'combo';
  const active = room.active.cards;
  const card = edge === 'left' ? active[0] : active.at(-1);
  const incoming = flip ? { ...card, value: card.other, other: card.value } : card;
  const hand = [...me.hand];
  hand.splice(insertAt, 0, incoming);
  const rest = edge === 'left' ? active.slice(1) : active.slice(0, -1);
  const selected = range ? hand.slice(range[0], range[1] + 1) : [];
  const valid = !combo || beats(selected, rest);
  function update(fn) { fn(); setRange(null); }
  async function submit() {
    const ok = await command(mode, { edge, flip, insertAt, ...(combo && { show: { start: range?.[0], count: selected.length } }) });
    if (ok) onClose();
  }
  return <Modal title={combo ? '招募并出牌' : '招募卡牌'} onClose={onClose} wide>
    <span className="eyebrow">{combo ? 'SCOUT & SHOW' : 'SCOUT'}</span><h2>{combo ? '招募一位，即刻登场' : '挑选你的新成员'}</h2>
    <div className="scout-layout"><div><label className="field-label">01 · 从哪一端招募？</label><div className="edge-picker">{['left', 'right'].slice(0, active.length === 1 ? 1 : 2).map(side => <button key={side} className={`edge-option ${edge === side ? 'active' : ''}`} onClick={() => update(() => { setEdge(side); setFlip(false); })}><Card card={side === 'left' ? active[0] : active.at(-1)} small/><span>{side === 'left' ? '最左侧' : '最右侧'}</span></button>)}</div></div>
      <div className="scout-settings"><label className="field-label">02 · 使用哪个数字？</label><div className="segmented"><button className={!flip ? 'active' : ''} onClick={() => update(() => setFlip(false))}>{card.value}</button><button className={flip ? 'active' : ''} onClick={() => update(() => setFlip(true))}>{card.other}</button></div><label className="field-label" htmlFor="insert-position">03 · 插入手牌的位置</label><select id="insert-position" value={insertAt} onChange={e => update(() => setInsertAt(Number(e.target.value)))}>{Array.from({ length: me.hand.length + 1 }, (_, i) => <option key={i} value={i}>{i === 0 ? '最左侧' : i === me.hand.length ? '最右侧' : `第 ${i} 张（${me.hand[i - 1].value}）之后`}</option>)}</select></div></div>
    <div className="preview-heading"><strong>招募后的手牌</strong><span>{combo ? '点击起点和终点，选择要打出的相邻组合' : `新成员 ${incoming.value} 将插入第 ${insertAt + 1} 位`}</span></div>
    <Hand cards={hand} range={range} setRange={combo ? setRange : undefined} small/>
    {combo && <div className="combo-status"><span>需要压过：{rest.length ? `${rest.map(c => c.value).join(' · ')}（${describeSet(rest)}）` : '空桌，可出任意有效组合'}</span><strong className={valid ? 'good' : 'muted'}>{range ? valid ? `${describeSet(selected)} · 可以出牌` : '这组牌无法压过桌面' : '请选择要打出的牌'}</strong></div>}
    <div className="dialog-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={busy || !valid} onClick={submit}>{combo ? '确认招募并出牌' : '确认招募'}</button></div>
    <p className="small-note">{room.players.length === 2 ? '消耗 1 枚招募筹码，招募后仍是你的回合。' : '桌面组合的拥有者获得 1 分。'}{combo ? ' 本操作消耗本轮唯一的招募＋出牌机会。' : ''}</p>
  </Modal>;
}

function ScoreTable({ result, duel }) {
  return <div className="score-table-wrap"><table className="score-table"><thead><tr><th>玩家</th><th>收牌</th><th>{duel ? '剩余筹码' : '招募'}</th><th>手牌扣分</th><th>本轮</th><th>总分</th></tr></thead><tbody>{result.rows.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.captured}</td><td>{p.chips}</td><td>{p.exempt ? <span className="exempt">免扣</span> : p.penalty ? `−${p.penalty}` : '0'}</td><td className={p.delta >= 0 ? 'good' : 'negative'}>{signed(p.delta)}</td><td><strong>{p.total}</strong></td></tr>)}</tbody></table></div>;
}

export default function Game({ room, command, busy, connected, notify }) {
  const [range, setRange] = useState(null);
  const [scoutMode, setScoutMode] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const me = room.players.find(p => p.id === room.you);
  const host = room.hostId === room.you;
  const duel = room.players.length === 2;
  const myTurn = room.phase === 'playing' && room.turnId === room.you;
  const disabled = busy || !connected;
  const activeCards = room.active?.cards ?? [];
  const current = room.players.find(p => p.id === room.turnId);
  const owner = room.players.find(p => p.id === room.active?.ownerId);
  const picked = range ? me.hand.slice(range[0], range[1] + 1) : [];
  const showValid = myTurn && beats(picked, activeCards);
  const scoutAllowed = myTurn && activeCards.length > 0 && (!duel || me.chips > 0);
  const allOnline = room.players.every(p => p.online);
  useEffect(() => { setRange(null); setScoutMode(null); }, [room.version]);
  async function copyInvite() {
    const link = `${location.origin}/?room=${room.code}`;
    try { await navigator.clipboard.writeText(link); notify('邀请链接已复制，发给朋友即可加入。'); }
    catch { notify(`复制这个链接邀请朋友：${link}`); }
  }
  function hint() {
    const options = legalShows(me.hand, activeCards);
    if (!options.length) { notify('当前没有能压过桌面的组合，可以尝试招募。'); return; }
    const best = options.at(-1);
    setRange([best.start, best.start + best.count - 1]);
  }
  return <main className="room-main">
    <div className="room-heading"><div><span className="eyebrow">{room.phase === 'lobby' ? 'PRIVATE TABLE' : `ROUND ${pad(room.round)} / ${pad(room.rounds)}`}</span><h1>好友私桌 <span className="room-code">{room.code}</span></h1></div><div className="room-tools"><button className="button secondary" onClick={copyInvite}>复制邀请链接</button>{host && room.phase !== 'lobby' && <button className="text-button" onClick={() => setConfirmReset(true)}>返回大厅</button>}</div></div>
    {!connected && <div className="notice" role="status">连接中断，正在自动重连。你的座位与手牌会保留。</div>}
    {room.phase === 'lobby' ? <section className="lobby"><span className="eyebrow">TAKE YOUR SEAT</span><h2>等朋友，来一场好戏。</h2><p className="muted">分享房间码或邀请链接，2～5 人就能开局。</p><div className="seats">{Array.from({ length: 5 }, (_, i) => { const p = room.players[i]; return <div className={`seat ${p ? 'occupied' : ''}`} key={i}><div className={`avatar ${p ? `avatar-${i}` : ''}`}>{p ? p.name.slice(0, 1) : '＋'}</div><strong>{p?.name || '等待入座'}{p?.id === room.you && <small>（你）</small>}</strong><span>{p ? `${p.id === room.hostId ? '房主 · ' : ''}${p.online ? '已入座' : '离线'}` : `SEAT ${pad(i + 1)}`}</span>{p && !p.online && host && <button className="text-button remove-seat" disabled={disabled} onClick={() => command('remove', { playerId: p.id })}>移除离线座位</button>}</div>; })}</div><div className="lobby-actions"><button className="button primary" disabled={disabled || room.players.length < 2 || !host || !allOnline} onClick={() => command('start')}>{host ? `开始游戏 · ${room.players.length}/5 人` : '等待房主开始'}</button><button className="text-button" disabled={disabled} onClick={() => command('leave')}>离开房间</button></div><p className="muted">{room.players.length < 2 ? '还差一位朋友。你也可以用另一台设备或无痕窗口加入。' : !allOnline ? '有玩家离线，等待重连或由房主移除后再开始。' : duel ? '双人规则：每轮 3 次招募，招募后继续自己的回合。' : `标准规则：每人 ${room.players.length === 3 ? 12 : room.players.length === 4 ? 11 : 9} 张，共 ${room.players.length} 轮。`}</p></section> : <div className="game-grid">
      <div className="game-primary">
        {['roundEnd', 'finished'].includes(room.phase) ? <section className="results-panel"><span className="eyebrow">{room.phase === 'finished' ? 'THE FINAL APPLAUSE' : 'CURTAIN CALL'}</span><div className="result-symbol">✦</div><h2>{room.phase === 'finished' ? `${room.players.filter(p => p.score === Math.max(...room.players.map(p => p.score))).map(p => p.name).join('、')} 获胜` : `第 ${room.round} 轮，谢幕。`}</h2><p className="muted">{room.players.find(p => p.id === room.history.at(-1).winnerId)?.name}{room.history.at(-1).reason === 'empty' ? ' 出完了所有手牌。' : ' 的表演无人压过，本轮剩余手牌免扣分。'}</p><ScoreTable result={room.history.at(-1)} duel={duel}/><div className="result-actions">{host ? <button className="button primary" disabled={disabled || (room.phase === 'roundEnd' && !allOnline)} onClick={() => command(room.phase === 'finished' ? 'reset' : 'next')}>{room.phase === 'finished' ? '回到大厅，再来一场' : '开始下一轮'}</button> : <p className="muted">等待房主{room.phase === 'finished' ? '返回大厅' : '开始下一轮'}。</p>}{!allOnline && room.phase === 'roundEnd' && <p className="small-note">有玩家离线，重连后可开始下一轮。</p>}</div>{room.history.length > 1 && <details className="history-details"><summary>查看前几轮计分</summary>{room.history.slice(0, -1).map(result => <div key={result.round}><h3>第 {result.round} 轮</h3><ScoreTable result={result} duel={duel}/></div>)}</details>}</section> : <>
          <div className="opponents">{room.players.filter(p => p.id !== room.you).map(p => { const i = room.players.findIndex(x => x.id === p.id); return <div key={p.id} className={`opponent ${room.turnId === p.id && room.phase === 'playing' ? 'is-turn' : ''}`}><div className={`avatar avatar-${i}`}>{p.name.slice(0, 1)}</div><div className="opponent-info"><strong>{p.name}</strong><span>{!p.online ? '离线 · 等待重连' : room.phase === 'orient' ? p.ready ? '已确认方向' : '选择方向中' : room.turnId === p.id ? '正在行动' : `${p.handCount} 张手牌`}</span></div><div className="mini-hand" aria-label={`${p.handCount} 张手牌`}>{Array.from({ length: Math.min(p.handCount, 4) }, (_, i) => <i key={i}/>)}<b>{p.handCount}</b></div></div>; })}</div>
          <section className={`play-table ${myTurn ? 'your-turn' : ''}`}>
            <div className="table-top"><span>THE MAIN STAGE</span><span>{duel ? '双人对决' : `${room.players.length} 人牌局`}</span></div>
            {room.phase === 'orient' ? <div className="stage-empty"><div className="stage-symbol">↻</div><h2>选一个好方向。</h2><p>可以整手旋转一次再看，满意后确认。<br/>开演后，手牌顺序就不能改变了。</p><span className="stage-tag">{room.players.filter(p => p.ready).length}/{room.players.length} 位玩家已确认</span></div> : <><div className={`turn-label ${myTurn ? 'active' : ''}`} aria-live="polite">{myTurn ? '轮到你了，好戏登场。' : `${current?.online ? '等待' : '等待重连：'} ${current?.name}${current?.online ? ' 行动' : ''}`}</div>{activeCards.length ? <><div className="table-cards">{activeCards.map(c => <Card key={c.id} card={c}/>)}</div><div className="active-description"><span>{owner?.name} 的表演</span><strong>{describeSet(activeCards)}</strong></div></> : <div className="stage-empty compact-empty"><div className="stage-symbol">✦</div><h2>舞台，等你登场。</h2><p>桌面暂无组合，可以打出任意有效牌组。</p></div>}<div className="stage-bottom"><span>{duel ? '招募后继续行动' : `连续招募 ${room.scoutStreak} / ${room.players.length - 1}`}</span><span>张数 ＞ 类型 ＞ 数值</span></div></>}
          </section>
          <section className="hand-panel"><div className="hand-heading"><div><span className="eyebrow">YOUR TROUPE</span><h2>我的手牌 <span>{me.hand.length}</span></h2></div><span className="hand-rule">顺序固定 · 点选相邻组合</span></div><Hand cards={me.hand} range={range} setRange={myTurn ? setRange : undefined} disabled={disabled}/>
            {room.phase === 'orient' ? <div className="hand-actions orientation-actions"><p>{me.ready ? '方向已锁定，等待其他玩家确认。' : '旋转会同时改变所有数字，并颠倒左右顺序。'}</p><div className="action-buttons"><button className="button secondary" disabled={disabled || me.ready} onClick={() => command('flip')}>↻ 旋转整手牌</button><button className="button primary" disabled={disabled || me.ready} onClick={() => command('ready')}>{me.ready ? '已确认' : '确认这个方向'}</button></div></div> : <><div className="selection-status"><span className={showValid ? 'good' : 'muted'}>{range ? `${describeSet(picked)}${showValid ? ' · 可以出牌' : ' · 无法出牌'}` : myTurn ? '点击一张出单牌；再点另一张，选中两者之间的所有牌。' : '等待轮到你行动。'}</span>{myTurn && <button className="text-button" disabled={disabled} onClick={hint}>提示可出组合</button>}</div><div className="hand-actions"><div className="your-chips"><span className="chip">✦</span><span>{duel ? `剩余 ${me.chips} 次招募` : `招募得分 ${me.chips}`}</span></div><div className="action-buttons"><button className="button secondary" disabled={disabled || !scoutAllowed} onClick={() => setScoutMode('scout')}>招募</button>{!duel && <button className="button special" disabled={disabled || !scoutAllowed || !me.special} onClick={() => setScoutMode('combo')}>招募＋出牌 <small>{me.special ? '1 次' : '已使用'}</small></button>}<button className="button primary" disabled={disabled || !showValid} onClick={() => command('show', { start: range[0], count: picked.length })}>出牌{picked.length ? ` · ${picked.length} 张` : ''}</button></div></div></>}
          </section>
        </>}
      </div>
      <aside className="game-sidebar"><section className="scoreboard"><div className="sidebar-title"><h2>本场记分牌</h2><span>POINTS</span></div>{[...room.players].sort((a, b) => b.score - a.score).map((p, rank) => <div className={`score-row ${p.id === room.you ? 'is-you' : ''}`} key={p.id}><span className="rank">{pad(rank + 1)}</span><div><strong>{p.name}{p.id === room.you ? '（你）' : ''}</strong><span>{!p.online ? '离线' : p.id === room.hostId ? '房主' : '玩家'} · {p.captured} 收牌 / {p.chips} 筹码</span></div><b>{p.score}</b></div>)}<p className="small-note">总分在每轮结束后结算。</p></section><section className="activity"><div className="sidebar-title"><h2>牌桌动态</h2><span>LIVE</span></div><ol>{room.logs.slice(0, 8).map((entry, i) => <li key={entry.id} className={i === 0 ? 'latest' : ''}><span>{entry.text}</span></li>)}</ol></section><div className="quick-rule"><span>✧</span><p>有时，拿走一张牌，<br/>比打出一手牌更精彩。</p></div></aside>
    </div>}
    {scoutMode && room.active && <ScoutDialog key={`${scoutMode}-${room.version}`} room={room} mode={scoutMode} command={command} busy={disabled} onClose={() => setScoutMode(null)}/>}
    {confirmReset && <Modal title="返回大厅" onClose={() => setConfirmReset(false)}><span className="eyebrow">BACK TO LOBBY</span><h2>结束本场，返回大厅？</h2><p>所有人将回到原房间大厅。本场手牌与分数会清空，可以重新开局。</p><div className="dialog-actions"><button className="button secondary" onClick={() => setConfirmReset(false)}>继续游戏</button><button className="button primary" disabled={disabled} onClick={async () => { if (await command('reset')) setConfirmReset(false); }}>结束并返回大厅</button></div></Modal>}
  </main>;
}
