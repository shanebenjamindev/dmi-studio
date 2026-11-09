// Facebook Messenger Widget & Floating Chat Heads
// Visible across the entire app without page reload/navigation.
// Multiple chat windows side-by-side, Chat Heads stacked on the right, online presence tracking,
// and balanced vector SVG Messenger branding.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../api';
import { useStore, toast } from '../store';
import { Icon } from './ui';
import { Avatar } from './boardkit';
import type { ChatMessage, ChatMember } from '../types';

export interface OpenWindow {
  id: string; // 'general' | memberId
  member?: ChatMember;
}

export interface MessengerState {
  openWindows: OpenWindow[]; // Open chat windows side-by-side (desktop max 3)
  activeId: string | null;   // Currently focused window id
  heads: ChatMember[];       // Minimized member chat heads stacked on right
  unreadMap: Record<string, number>; // 'general': count, [memberId]: count
}

const getHeadsStorageKey = (userId?: string) => `dms.${userId || 'guest'}.chat_active_heads`;
const STORAGE_READ_PREFIX = 'dms.chat_read_at_';

const loadStoredHeads = (userId?: string): ChatMember[] => {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(getHeadsStorageKey(userId));
    const list: ChatMember[] = raw ? JSON.parse(raw) : [];
    return list.filter((h) => h.id !== userId);
  } catch {
    return [];
  }
};

const saveStoredHeads = (heads: ChatMember[], userId?: string) => {
  if (!userId) return;
  try {
    const filtered = heads.filter((h) => h.id !== userId).slice(0, 6);
    localStorage.setItem(getHeadsStorageKey(userId), JSON.stringify(filtered));
  } catch {
    /* private mode */
  }
};

export const getConvReadAt = (id: string): number => {
  try {
    return Number(localStorage.getItem(STORAGE_READ_PREFIX + id)) || 0;
  } catch {
    return 0;
  }
};

export const setConvReadAt = (id: string, t: number) => {
  try {
    localStorage.setItem(STORAGE_READ_PREFIX + id, String(t));
  } catch {
    /* private mode */
  }
};

/** Check if a member was active in the last 3 minutes */
export const isUserOnline = (lastActive?: number | null): boolean => {
  if (!lastActive) return false;
  return Date.now() - lastActive < 3 * 60 * 1000;
};

/** Format last active status string like Facebook Messenger */
export const formatOnlineStatus = (lastActive?: number | null): string => {
  if (!lastActive) return 'Ngoại tuyến';
  const diff = Math.max(0, Date.now() - lastActive);
  if (diff < 3 * 60 * 1000) return 'Đang hoạt động';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `Hoạt động ${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hoạt động ${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hoạt động hôm qua';
  if (days < 30) return `Hoạt động ${days} ngày trước`;
  return `Hoạt động ${new Date(lastActive).toLocaleDateString('vi-VN')}`;
};

export const formatChatTime = (t: number) => {
  const d = new Date(t), now = new Date();
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === now.toDateString() ? timeStr : `${d.getDate()}/${d.getMonth() + 1} ${timeStr}`;
};

export const formatChatDateDivider = (t: number) => {
  const d = new Date(t), now = new Date();
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  if (d.toDateString() === now.toDateString()) return timeStr;
  return `${timeStr} ${dayNames[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}`;
};

let messengerState: MessengerState = {
  openWindows: [],
  activeId: null,
  heads: [],
  unreadMap: {},
};

const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

export const useMessengerState = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => messengerState,
    () => messengerState
  );

/** Open a conversation window (general or member DM) side-by-side */
export const openConversation = (id: string = 'general', member?: ChatMember, currentUserId?: string) => {
  const isGeneral = id === 'general';
  if (!isGeneral && currentUserId && id === currentUserId) return; // Cannot chat with oneself!

  let curWindows = messengerState.openWindows.filter((w) => w.id === 'general' || (currentUserId ? w.id !== currentUserId : true));
  let curHeads = [...messengerState.heads].filter((h) => h.id !== currentUserId);

  if (!isGeneral && member) {
    if (!curHeads.some((h) => h.id === member.id)) {
      curHeads = [member, ...curHeads].slice(0, 6);
      saveStoredHeads(curHeads, currentUserId);
    }
  }

  // If already open, bring to focus
  const existingIdx = curWindows.findIndex((w) => w.id === id);
  if (existingIdx >= 0) {
    const existing = curWindows[existingIdx];
    curWindows.splice(existingIdx, 1);
    curWindows.push(existing);
  } else {
    // Limit to 3 windows on desktop; oldest collapses into chat head
    if (curWindows.length >= 3) {
      curWindows.shift();
    }
    curWindows.push({ id, member });
  }

  setConvReadAt(id, Date.now());
  const updatedUnread = { ...messengerState.unreadMap, [id]: 0 };

  messengerState = {
    ...messengerState,
    openWindows: curWindows,
    activeId: id,
    heads: curHeads,
    unreadMap: updatedUnread,
  };
  emit();
};

/** Minimize a specific conversation into its chat head */
export const minimizeConversation = (id: string, member?: ChatMember, currentUserId?: string) => {
  const isGeneral = id === 'general';
  let curHeads = [...messengerState.heads].filter((h) => h.id !== currentUserId);
  if (!isGeneral && member && member.id !== currentUserId && !curHeads.some((h) => h.id === member.id)) {
    curHeads = [member, ...curHeads].slice(0, 6);
    saveStoredHeads(curHeads, currentUserId);
  }

  const remaining = messengerState.openWindows.filter((w) => w.id !== id);
  const nextActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null;

  messengerState = {
    ...messengerState,
    openWindows: remaining,
    activeId: nextActive,
    heads: curHeads,
  };
  emit();
};

/** Close a specific window entirely */
export const closeConversation = (id: string) => {
  const remaining = messengerState.openWindows.filter((w) => w.id !== id);
  const nextActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null;

  messengerState = {
    ...messengerState,
    openWindows: remaining,
    activeId: nextActive,
  };
  emit();
};

/** Toggle open/minimize a conversation */
export const toggleConversation = (id: string = 'general', member?: ChatMember, currentUserId?: string) => {
  const isOpen = messengerState.openWindows.some((w) => w.id === id);
  if (isOpen) {
    minimizeConversation(id, member, currentUserId);
  } else {
    openConversation(id, member, currentUserId);
  }
};

/** Legacy toggle shorthand for Workspace dock */
export const toggleMessenger = () => toggleConversation('general');

/** Dismiss a member chat head entirely from the stack */
export const dismissChatHead = (memberId: string, currentUserId?: string) => {
  const updatedHeads = messengerState.heads.filter((h) => h.id !== memberId && h.id !== currentUserId);
  saveStoredHeads(updatedHeads, currentUserId);
  const remainingWindows = messengerState.openWindows.filter((w) => w.id !== memberId);
  const nextActive = remainingWindows.length > 0 ? remainingWindows[remainingWindows.length - 1].id : null;

  messengerState = {
    ...messengerState,
    heads: updatedHeads,
    openWindows: remainingWindows,
    activeId: nextActive,
  };
  emit();
};

/** Compress image before sending as chat message */
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(e.target?.result as string);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(e.target?.result as string);
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Top navigation bar button for Messenger - Clean, outline harmonic with QuickNotes & NotificationBell */
export function MessengerTopButton() {
  const { openWindows, unreadMap } = useMessengerState();
  const totalUnread = Object.values(unreadMap).reduce((a, b) => a + b, 0);
  const hasOpen = openWindows.length > 0;

  return (
    <button
      type="button"
      className={'tb-theme-btn tb-msg-top' + (hasOpen ? ' on' : '')}
      onClick={() => toggleConversation('general')}
      title="Tin nhắn (Messenger)"
      aria-label="Mở tin nhắn"
      aria-expanded={hasOpen}
    >
      <Icon name="messenger" size={19} />
      {totalUnread > 0 && (
        <span className="tb-msg-badge">{totalUnread > 9 ? '9+' : totalUnread}</span>
      )}
    </button>
  );
}

/** Single Chat Box Window (Side-by-side enabled) */
function ChatWindowView({
  win,
  index,
  totalWindows,
  allMembers,
  onOpenDM,
}: {
  win: OpenWindow;
  index: number;
  totalWindows: number;
  allMembers: ChatMember[];
  onOpenDM: (m: ChatMember) => void;
}) {
  const me = useStore((s) => s.user);
  const isGeneral = win.id === 'general';
  const recipient = isGeneral
    ? null
    : win.member || allMembers.find((m) => m.id === win.id) || { id: win.id, name: 'Thành viên', email: '' };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [searchMember, setSearchMember] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load messages
  const loadMessages = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const msgs = await api.chatMessages(
          isGeneral ? 'general' : 'dm',
          !isGeneral ? win.id : undefined
        );
        setMessages(msgs);
        setConvReadAt(win.id, Date.now());
      } catch {
        /* ignore */
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [isGeneral, win.id]
  );

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Background polling for this conversation
  useEffect(() => {
    const timer = setInterval(() => {
      loadMessages(true);
    }, 3500);
    return () => clearInterval(timer);
  }, [loadMessages]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Send text message
  const handleSend = async (contentToSend?: string) => {
    const content = (contentToSend ?? text).trim();
    if (!content || sending) return;
    setSending(true);
    if (!contentToSend) setText('');
    setShowEmojiPicker(false);

    try {
      const newMsg = await api.sendChatMessage(
        content,
        isGeneral ? 'general' : 'dm',
        !isGeneral ? win.id : undefined
      );
      setMessages((prev) => [...prev, newMsg]);
      setConvReadAt(win.id, Date.now());
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 50);
    } catch (e: any) {
      toast(e.message || 'Không thể gửi tin nhắn', true);
      if (!contentToSend) setText(content);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // Send photo
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Chỉ cho phép tải lên tệp hình ảnh', true);
      return;
    }
    try {
      toast('Đang xử lý ảnh…');
      const dataUrl = await fileToDataUrl(file);
      await handleSend(dataUrl);
    } catch (err: any) {
      toast('Lỗi khi tải ảnh: ' + (err.message || ''), true);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Clear conversation
  const clearHistory = async () => {
    setShowMenu(false);
    const label = isGeneral ? 'Kênh chung' : `cuộc trò chuyện với ${recipient?.name || 'thành viên'}`;
    if (!confirm(`Xoá toàn bộ lịch sử ${label}? Hành động này không thể hoàn tác.`)) return;
    try {
      await api.clearChatMessages(
        isGeneral ? 'general' : 'dm',
        !isGeneral ? win.id : undefined
      );
      setMessages([]);
      toast('Đã xoá lịch sử chat');
    } catch (e: any) {
      toast(e.message || 'Không thể xoá lịch sử', true);
    }
  };

  // Delete single message
  const deleteMsg = async (msgId: string) => {
    if (!confirm('Xoá tin nhắn này?')) return;
    try {
      await api.deleteChatMessage(msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (e: any) {
      toast(e.message || 'Không thể xoá tin nhắn', true);
    }
  };

  // Online status info
  const isOnline = !isGeneral && recipient ? isUserOnline(recipient.lastActive) : false;
  const onlineText = isGeneral
    ? `Detailers Movement • ${allMembers.filter((m) => isUserOnline(m.lastActive)).length} đang onl`
    : formatOnlineStatus(recipient?.lastActive);

  // Desktop positioning: stacked side-by-side to the left of the heads stack (76px from right)
  const windowRightPx = 76 + (totalWindows - 1 - index) * 342;

  // Emoji palette
  const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👏', '🙏', '😍', '✨', '💯', '🚀', '👌', '😎', '🥳'];

  return (
    <div
      className="fmsg-window"
      role="dialog"
      aria-label={isGeneral ? 'Kênh chung Messenger' : `Tin nhắn với ${recipient?.name}`}
      style={{ right: `${windowRightPx}px` }}
    >
      {/* ---------------- Header (Exact Messenger Desktop style) ---------------- */}
      <header className="fmsg-header">
        <div className="fmsg-header-info">
          {isGeneral ? (
            <div className="fmsg-header-icon">
              <Icon name="messenger" size={24} />
            </div>
          ) : (
            <div className="fmsg-avatar-wrap">
              <Avatar m={recipient || { id: win.id, name: 'Thành viên' }} size={34} />
              <span className={'fmsg-status-dot' + (isOnline ? ' online' : ' offline')} />
            </div>
          )}

          <div className="fmsg-header-titles">
            <button
              type="button"
              className="fmsg-header-title-btn"
              onClick={() => setShowMenu(!showMenu)}
              title="Tuỳ chọn cuộc trò chuyện"
            >
              <b className="fmsg-header-title">
                {isGeneral ? 'Kênh chung' : recipient?.name || 'Nhắn tin'}
              </b>
              <svg className="fmsg-header-chevron" width="11" height="11" viewBox="0 0 12 12">
                <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className={'fmsg-header-sub' + (isOnline ? ' is-online' : '')}>
              {onlineText}
            </span>
          </div>
        </div>

        {/* Action icons right (Audio call, Video call, Minimize, Close) */}
        <div className="fmsg-header-actions">
          <button
            type="button"
            className="fmsg-head-action-btn"
            onClick={() => toast('Tính năng gọi thoại đang được kết nối…')}
            title="Bắt đầu cuộc gọi thoại"
            aria-label="Gọi thoại"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
            </svg>
          </button>
          <button
            type="button"
            className="fmsg-head-action-btn"
            onClick={() => toast('Tính năng gọi video đang được kết nối…')}
            title="Bắt đầu cuộc gọi video"
            aria-label="Gọi video"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
            </svg>
          </button>
          <button
            type="button"
            className="fmsg-head-action-btn"
            onClick={() => minimizeConversation(win.id, recipient || undefined, me?.id)}
            title="Thu nhỏ vào bong bóng chat"
            aria-label="Thu nhỏ"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            className="fmsg-head-action-btn close"
            onClick={() => closeConversation(win.id)}
            title="Đóng cửa sổ chat"
            aria-label="Đóng"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>
      </header>

      {/* Header Dropdown Menu */}
      {showMenu && (
        <div className="fmsg-dropdown-menu">
          <button
            type="button"
            onClick={() => {
              setShowMenu(false);
              setShowPicker(true);
            }}
          >
            <Icon name="chat" size={14} /> Chuyển sang nhắn người khác
          </button>
          {!isGeneral && recipient?.email && (
            <a
              href={`#profile`}
              onClick={(e) => {
                e.preventDefault();
                setShowMenu(false);
                window.location.hash = `#profile`;
              }}
            >
              <Icon name="user" size={14} /> Xem hồ sơ thành viên
            </a>
          )}
          {(isGeneral ? me?.role === 'admin' : true) && (
            <button type="button" className="danger" onClick={clearHistory}>
              <Icon name="trash" size={14} /> Xoá toàn bộ lịch sử chat
            </button>
          )}
        </div>
      )}

      {/* Member Selector Modal */}
      {showPicker && (
        <div className="fmsg-picker">
          <div className="fmsg-picker-head">
            <b>Chọn người nhắn tin</b>
            <button
              type="button"
              className="fmsg-picker-close"
              onClick={() => setShowPicker(false)}
              aria-label="Đóng"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="fmsg-picker-search">
            <Icon name="search" size={14} />
            <input
              autoFocus
              value={searchMember}
              onChange={(e) => setSearchMember(e.target.value)}
              placeholder="Tìm theo tên hoặc email…"
            />
          </div>
          <div className="fmsg-picker-list">
            {allMembers
              .filter(
                (m) =>
                  m.id !== me?.id &&
                  (m.name.toLowerCase().includes(searchMember.toLowerCase().trim()) ||
                    m.email.toLowerCase().includes(searchMember.toLowerCase().trim()))
              )
              .map((m) => {
                const onl = isUserOnline(m.lastActive);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="fmsg-member-item"
                    onClick={() => {
                      onOpenDM(m);
                      setShowPicker(false);
                    }}
                  >
                    <div className="fmsg-member-av-wrap">
                      <Avatar m={m} size={30} />
                      <span className={'fmsg-status-dot' + (onl ? ' online' : ' offline')} />
                    </div>
                    <div className="fmsg-member-info">
                      <span className="fmsg-member-name">{m.name}</span>
                      <small className="fmsg-member-status">{formatOnlineStatus(m.lastActive)}</small>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* ---------------- Message Feed ---------------- */}
      <div className="fmsg-feed" ref={scrollRef}>
        {loading && !messages.length && (
          <div className="fmsg-loading">Đang tải tin nhắn…</div>
        )}
        {!loading && !messages.length && (
          <div className="fmsg-empty">
            <div className="fmsg-empty-icon">
              <Icon name="messenger" size={44} />
            </div>
            <p>
              {isGeneral
                ? 'Chào mừng bạn đến với Kênh chung! Hãy gửi tin nhắn hoặc ảnh để trò chuyện cùng đội ngũ.'
                : `Bắt đầu cuộc trò chuyện với ${recipient?.name || 'thành viên'}.`}
            </p>
          </div>
        )}

        {messages.map((m, idx) => {
          const isPhoto = m.message.startsWith('data:image/') || /^https?:\/\/.*\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(m.message);
          const isLike = m.message === '👍';
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const nextMsg = idx < messages.length - 1 ? messages[idx + 1] : null;
          const showDivider = !prevMsg || (m.createdAt - prevMsg.createdAt > 15 * 60 * 1000);
          const isFirstInCluster = !prevMsg || prevMsg.senderId !== m.senderId || showDivider;
          const isLastInCluster = !nextMsg || nextMsg.senderId !== m.senderId || (nextMsg.createdAt - m.createdAt > 15 * 60 * 1000);

          return (
            <div key={m.id} className="fmsg-msg-wrap">
              {showDivider && (
                <div className="fmsg-time-divider">
                  <span>{formatChatDateDivider(m.createdAt)}</span>
                </div>
              )}
              <div className={'fmsg-msg' + (m.isMe ? ' me' : '') + (isFirstInCluster ? ' cluster-first' : '') + (isLastInCluster ? ' cluster-last' : '')}>
                {!m.isMe && (
                  <div className="fmsg-msg-avatar">
                    {isLastInCluster ? (
                      <Avatar m={{ id: m.senderId, name: m.senderName }} size={26} />
                    ) : (
                      <div className="fmsg-msg-avatar-placeholder" />
                    )}
                  </div>
                )}
                <div className="fmsg-msg-content">
                  {!m.isMe && isGeneral && isFirstInCluster && (
                    <div className="fmsg-msg-sender">{m.senderName}</div>
                  )}
                  <div className={'fmsg-bubble-box' + (isPhoto ? ' is-photo' : '') + (isLike ? ' is-like' : '')} title={formatChatTime(m.createdAt)}>
                    {isPhoto ? (
                      <img
                        src={m.message}
                        alt="Ảnh chat"
                        className="fmsg-bubble-photo"
                        onClick={() => window.open(m.message, '_blank')}
                      />
                    ) : isLike ? (
                      <span className="fmsg-bubble-like-sticker">👍</span>
                    ) : (
                      <span className="fmsg-bubble-text">{m.message}</span>
                    )}
                    {!isLike && (
                      <span className="fmsg-bubble-meta">
                        <span className="fmsg-bubble-time">{formatChatTime(m.createdAt)}</span>
                        {(m.isMe || me?.role === 'admin') && (
                          <button
                            type="button"
                            className="fmsg-bubble-del"
                            onClick={() => deleteMsg(m.id)}
                            title="Xoá tin nhắn"
                            aria-label="Xoá"
                          >
                            <Icon name="trash" size={11} />
                          </button>
                        )}
                      </span>
                    )}
                    {isLike && (m.isMe || me?.role === 'admin') && (
                      <button
                        type="button"
                        className="fmsg-bubble-del like-del"
                        onClick={() => deleteMsg(m.id)}
                        title="Xoá tin nhắn"
                        aria-label="Xoá"
                      >
                        <Icon name="trash" size={11} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Emoji Picker Popover */}
      {showEmojiPicker && (
        <div className="fmsg-quick-emojis">
          {QUICK_EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              className="fmsg-emoji-item"
              onClick={() => {
                setText((t) => t + em);
                setShowEmojiPicker(false);
                inputRef.current?.focus();
              }}
            >
              {em}
            </button>
          ))}
        </div>
      )}

      {/* ---------------- Footer (Exact Messenger Input Bar without Sticker & GIF buttons) ---------------- */}
      <form
        className="fmsg-footer"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        {/* Left Action Buttons: Only Mic and Photo */}
        <div className="fmsg-footer-tools">
          {/* Mic */}
          <button
            type="button"
            className="fmsg-tool-btn"
            onClick={() => toast('Tính năng ghi âm thoại đang được phát triển')}
            title="Ghi âm thoại"
            aria-label="Ghi âm thoại"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#0084ff">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          </button>

          {/* Photo upload */}
          <button
            type="button"
            className="fmsg-tool-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Đính kèm hình ảnh"
            aria-label="Đính kèm hình ảnh"
          >
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePhotoUpload}
            />
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#0084ff">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
            </svg>
          </button>
        </div>

        {/* Center Pill Input with Aa placeholder and smile emoji */}
        <div className="fmsg-input-pill">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Aa"
            aria-label="Nội dung tin nhắn"
          />
          <button
            type="button"
            className="fmsg-pill-emoji-btn"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            title="Biểu tượng cảm xúc"
            aria-label="Biểu tượng cảm xúc"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#0084ff">
              <circle cx="12" cy="12" r="10" fill="none" stroke="#0084ff" strokeWidth="2" />
              <circle cx="8.5" cy="9.5" r="1.5" fill="#0084ff" />
              <circle cx="15.5" cy="9.5" r="1.5" fill="#0084ff" />
              <path d="M8 14.5s1.5 2.5 4 2.5 4-2.5 4-2.5" fill="none" stroke="#0084ff" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Right Action: Thumbs Up 👍 when empty, Send ✈️ when text present */}
        {text.trim().length === 0 ? (
          <button
            type="button"
            className="fmsg-like-btn"
            onClick={() => handleSend('👍')}
            title="Gửi biểu tượng thích (Like)"
            aria-label="Gửi thích"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#0084ff">
              <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            className="fmsg-send-action-btn"
            disabled={sending}
            title="Gửi tin nhắn (Enter)"
            aria-label="Gửi tin nhắn"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#0084ff">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}

/** Full floating Messenger component with Chat Heads and side-by-side windows */
export function Messenger() {
  const { openWindows, heads, unreadMap } = useMessengerState();
  const me = useStore((s) => s.user);
  const currentUserId = me?.id;
  const lastUserRef = useRef<string | undefined>(currentUserId);

  const [allMembers, setAllMembers] = useState<ChatMember[]>([]);

  // When switching user accounts in the same browser, reload heads for that specific user
  useEffect(() => {
    if (lastUserRef.current !== currentUserId) {
      lastUserRef.current = currentUserId;
      const loaded = loadStoredHeads(currentUserId);
      messengerState = {
        openWindows: [],
        activeId: null,
        heads: loaded,
        unreadMap: {},
      };
      emit();
    }
  }, [currentUserId]);

  // Load team members and online statuses
  const loadMembers = useCallback(async () => {
    try {
      const list = await api.chatMembers();
      setAllMembers(list.filter((m) => m.id !== currentUserId));
    } catch {
      /* ignore */
    }
  }, [currentUserId]);

  useEffect(() => {
    loadMembers();
    const interval = setInterval(loadMembers, 8000);
    return () => clearInterval(interval);
  }, [loadMembers]);

  // Periodic unread check across general and all DMs
  useEffect(() => {
    const checkUnread = async () => {
      try {
        const genReadAt = getConvReadAt('general');
        const res = await api.chatUnread(genReadAt);

        let curHeads = [...messengerState.heads].filter((h) => h.id !== currentUserId);
        const nextUnreadMap: Record<string, number> = {
          general: openWindows.some((w) => w.id === 'general') ? 0 : res.general || 0,
        };

        let headsChanged = false;
        if (res.dms && res.dms.length > 0) {
          for (const dm of res.dms) {
            if (dm.senderId === currentUserId) continue;
            const isThisDmOpen = openWindows.some((w) => w.id === dm.senderId);
            nextUnreadMap[dm.senderId] = isThisDmOpen ? 0 : dm.count;

            // If someone messaged this user and their head isn't visible, auto-pop their Chat Head!
            if (!curHeads.some((h) => h.id === dm.senderId)) {
              const fullMember = allMembers.find((m) => m.id === dm.senderId);
              const newHead: ChatMember = fullMember || {
                id: dm.senderId,
                name: dm.senderName || 'Thành viên',
                email: dm.senderEmail || '',
                lastAt: dm.lastAt,
              };
              curHeads = [newHead, ...curHeads].slice(0, 6);
              headsChanged = true;
            }
          }
        }

        if (headsChanged) {
          saveStoredHeads(curHeads, currentUserId);
        }

        messengerState = {
          ...messengerState,
          heads: curHeads,
          unreadMap: { ...messengerState.unreadMap, ...nextUnreadMap },
        };
        emit();
      } catch {
        /* ignore */
      }
    };

    checkUnread();
    const timer = setInterval(checkUnread, 4000);
    return () => clearInterval(timer);
  }, [openWindows, currentUserId, allMembers]);

  const totalGeneralUnread = unreadMap.general || 0;
  const isGeneralOpen = openWindows.some((w) => w.id === 'general');

  return (
    <>
      {/* ----------------- Floating Chat Heads Stack (Right Edge) ----------------- */}
      <div className="fmsg-heads-stack" aria-label="Messenger chat heads">
        {/* Main Messenger Bubble (bottom) */}
        <div className="fmsg-head-item">
          <button
            type="button"
            className={'fmsg-bubble' + (isGeneralOpen ? ' active' : '')}
            onClick={() => toggleConversation('general', undefined, currentUserId)}
            title="Kênh chung (Messenger)"
            aria-label="Kênh chung"
          >
            <span className="fmsg-bubble-icon">
              <Icon name="messenger" size={28} />
            </span>
            {totalGeneralUnread > 0 && (
              <span className="fmsg-bubble-badge">
                {totalGeneralUnread > 9 ? '9+' : totalGeneralUnread}
              </span>
            )}
          </button>
        </div>

        {/* Member Avatar Chat Heads (stacked upward, illustrated in user screenshot) */}
        {heads
          .filter((m) => m.id !== currentUserId)
          .map((m) => {
            const isCurrentOpen = openWindows.some((w) => w.id === m.id);
            const unread = unreadMap[m.id] || 0;
            const onl = isUserOnline(m.lastActive);

            return (
              <div key={m.id} className="fmsg-head-item">
                <button
                  type="button"
                  className={'fmsg-avatar-bubble' + (isCurrentOpen ? ' active' : '')}
                  onClick={() => toggleConversation(m.id, m, currentUserId)}
                  title={`Nhắn với ${m.name} (${formatOnlineStatus(m.lastActive)})`}
                  aria-label={m.name}
                >
                  <Avatar m={m} size={48} />
                  <span className={'fmsg-head-status-dot' + (onl ? ' online' : ' offline')} />
                  {unread > 0 && (
                    <span className="fmsg-bubble-badge">{unread > 9 ? '9+' : unread}</span>
                  )}
                </button>
                <button
                  type="button"
                  className="fmsg-head-dismiss"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissChatHead(m.id, currentUserId);
                  }}
                  title="Đóng bong bóng chat này"
                  aria-label="Đóng bong bóng chat"
                >
                  <Icon name="x" size={10} />
                </button>
              </div>
            );
          })}
      </div>

      {/* ----------------- Open Chat Windows (Side-by-side) ----------------- */}
      {(() => {
        const visibleWindows = openWindows.filter((win) => win.id === 'general' || (currentUserId ? win.id !== currentUserId : true));
        return visibleWindows.map((win, idx) => (
          <ChatWindowView
            key={win.id}
            win={win}
            index={idx}
            totalWindows={visibleWindows.length}
            allMembers={allMembers}
            onOpenDM={(m) => openConversation(m.id, m, currentUserId)}
          />
        ));
      })()}
    </>
  );
}
