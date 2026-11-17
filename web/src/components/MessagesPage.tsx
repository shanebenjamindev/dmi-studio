import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { openProfile, toast, useStore } from '../store';
import type { ChatChannel, ChatMember, ChatMessage, Workspace } from '../types';
import { askConfirm } from './AskDialog';
import { Avatar } from './boardkit';
import { BrandLoading } from './BrandLoading';
import { formatChatTime, formatOnlineStatus, getConvReadAt, isUserOnline, setConvReadAt } from './Messenger';
import { Icon } from './ui';

interface BuiltinChannel {
  id: string;
  serverId: string;
  category: string;
  name: string;
  topic: string;
  builtin?: boolean;
}

const COMPANY_CHANNELS: BuiltinChannel[] = [
  { id: 'thong-bao', serverId: 'company', category: 'KÊNH THÔNG TIN', name: 'thong-bao', topic: 'Thông báo chung và cập nhật quan trọng toàn công ty', builtin: true },
  { id: 'general', serverId: 'company', category: 'KÊNH CHUNG', name: 'general', topic: 'Kênh trao đổi công việc chung của cả công ty', builtin: true },
  { id: 'y-tuong', serverId: 'company', category: 'KÊNH CHUNG', name: 'y-tuong', topic: 'Đóng góp ý tưởng sáng tạo, cải tiến quy trình', builtin: true },
  { id: 'account', serverId: 'company', category: 'PHÒNG BAN & DỊCH VỤ', name: 'account', topic: 'Trao đổi brief khách hàng, tiến độ Account', builtin: true },
  { id: 'execution', serverId: 'company', category: 'PHÒNG BAN & DỊCH VỤ', name: 'execution', topic: 'Triển khai sản xuất Media, Design, Video, Content', builtin: true },
  { id: 'paid-ads', serverId: 'company', category: 'PHÒNG BAN & DỊCH VỤ', name: 'paid-ads', topic: 'Chiến dịch quảng cáo, tối ưu ngân sách & báo cáo', builtin: true },
  { id: 'website', serverId: 'company', category: 'PHÒNG BAN & DỊCH VỤ', name: 'website', topic: 'Kỹ thuật website, hosting, domain & SEO', builtin: true },
];

const QUICK_REACTIONS = ['👍', '❤️', '🔥', '✅', '🎉', '😂'];
const EMOJI_PALETTE = ['😀', '😂', '🥰', '😎', '🤔', '🙌', '👍', '👏', '🔥', '✨', '🎉', '❤️', '💯', '✅', '🚀', '📌', '⚡', '🤝'];

function workspaceChannels(ws: Workspace): BuiltinChannel[] {
  const prefix = `ws_${ws.id}_`;
  return [
    { id: `${prefix}chung`, serverId: ws.id, category: 'KÊNH NHÃN HÀNG', name: 'chung', topic: `Trao đổi chung của nhãn hàng ${ws.name}`, builtin: true },
    { id: `${prefix}brief`, serverId: ws.id, category: 'KÊNH NHÃN HÀNG', name: 'brief-khach-hang', topic: `Brief, tài liệu và yêu cầu từ khách hàng ${ws.customerName || ws.name}`, builtin: true },
    { id: `${prefix}san-xuat`, serverId: ws.id, category: 'TRIỂN KHAI', name: 'san-xuat', topic: `Sản xuất nội dung, hình ảnh, video cho ${ws.name}`, builtin: true },
    { id: `${prefix}bao-cao`, serverId: ws.id, category: 'TRIỂN KHAI', name: 'bao-cao-nghiem-thu', topic: `Báo cáo kết quả và nghiệm thu công việc ${ws.name}`, builtin: true },
  ];
}

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

export function MessagesPage() {
  const me = useStore((s) => s.user)!;
  const roles = useStore((s) => s.roles);

  // 'dm' = Direct Messages hub; 'company' = DMI Studio hub; otherwise workspaceId
  const [serverId, setServerId] = useState<string>('company');
  const [activeChannelId, setActiveChannelId] = useState<string>('general');
  const [activeDmUserId, setActiveDmUserId] = useState<string | null>(null);

  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [customChannels, setCustomChannels] = useState<ChatChannel[]>([]);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);

  // UI toggles
  const [showMembers, setShowMembers] = useState(true);
  const [showPins, setShowPins] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dmSearch, setDmSearch] = useState('');
  const [dmFilter, setDmFilter] = useState<'all' | 'online' | 'unread'>('all');
  const [foldedCats, setFoldedCats] = useState<Record<string, boolean>>({});

  // Composer state
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);

  // @mention autocomplete in composer (excludes current user `me.id` — "trừ bản thân")
  const [mentionState, setMentionState] = useState<{ q: string; start: number; end: number } | null>(null);
  const [mentionPick, setMentionPick] = useState(0);

  // Create channel modal
  const [creatingChannel, setCreatingChannel] = useState<{ category: string } | null>(null);
  const [newChanName, setNewChanName] = useState('');
  const [newChanTopic, setNewChanTopic] = useState('');
  const [newChanCat, setNewChanCat] = useState('KÊNH CHUNG');
  const [creatingBusy, setCreatingBusy] = useState(false);

  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastFetchedIdRef = useRef<string | null>(null);

  // Load workspaces, custom channels, members, unread counts
  const loadSidebarData = useCallback(async () => {
    try {
      const [wsList, chList, memList, unreadRes] = await Promise.all([
        api.workspaces().catch(() => [] as Workspace[]),
        api.chatChannels().catch(() => [] as ChatChannel[]),
        api.chatMembers().catch(() => [] as ChatMember[]),
        api.chatUnread(getConvReadAt('general')).catch(() => ({ unread: 0, general: 0, dms: [] })),
      ]);
      setSpaces(wsList.filter((w) => w.id !== 'company'));
      setCustomChannels(chList);
      setMembers(memList.filter((m) => m.id !== me.id));
      const map: Record<string, number> = { general: unreadRes.general || 0 };
      for (const dm of unreadRes.dms || []) {
        map[dm.senderId] = dm.count;
      }
      setUnreadMap(map);
    } catch {
      // ignore transient network errors
    }
  }, [me.id]);

  useEffect(() => {
    void loadSidebarData();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadSidebarData();
    }, 8000);
    return () => clearInterval(timer);
  }, [loadSidebarData]);

  // Channels for current server
  const currentServerChannels = useMemo<BuiltinChannel[]>(() => {
    if (serverId === 'dm') return [];
    const base =
      serverId === 'company'
        ? COMPANY_CHANNELS
        : (() => {
            const ws = spaces.find((w) => w.id === serverId);
            return ws ? workspaceChannels(ws) : [];
          })();
    const custom = customChannels
      .filter((c) => c.serverId === serverId)
      .map((c) => ({
        id: c.id,
        serverId: c.serverId,
        category: c.category,
        name: c.name,
        topic: c.topic,
        builtin: false,
      }));
    return [...base, ...custom];
  }, [serverId, spaces, customChannels]);

  // Keep activeChannelId valid when switching servers
  useEffect(() => {
    if (serverId === 'dm') {
      if (!activeDmUserId && members.length > 0) {
        setActiveDmUserId(members[0].id);
      }
      return;
    }
    if (currentServerChannels.length > 0 && !currentServerChannels.some((c) => c.id === activeChannelId)) {
      setActiveChannelId(currentServerChannels[0].id);
    }
  }, [serverId, currentServerChannels, activeChannelId, activeDmUserId, members]);

  const activeChannel = useMemo(
    () => currentServerChannels.find((c) => c.id === activeChannelId) || currentServerChannels[0] || null,
    [currentServerChannels, activeChannelId],
  );

  const activeDmMember = useMemo(
    () => (activeDmUserId ? members.find((m) => m.id === activeDmUserId) || null : null),
    [members, activeDmUserId],
  );

  // Load messages for active conversation
  const loadMessages = useCallback(
    async (initial = false) => {
      const isDm = serverId === 'dm';
      if (isDm && !activeDmUserId) {
        setMessages([]);
        setLoadingMsgs(false);
        return;
      }
      const chanKey = isDm ? 'dm' : activeChannel?.id || 'general';
      const recip = isDm ? activeDmUserId || undefined : undefined;
      if (initial) setLoadingMsgs(true);
      try {
        const list = await api.chatMessages(chanKey, recip, 0);
        setMessages(list);
        const convKey = isDm && recip ? recip : chanKey;
        setConvReadAt(convKey, Date.now());
        setUnreadMap((prev) => (prev[convKey] ? { ...prev, [convKey]: 0 } : prev));
        const newestId = list.at(-1)?.id || null;
        if (initial || newestId !== lastFetchedIdRef.current) {
          lastFetchedIdRef.current = newestId;
          requestAnimationFrame(() => {
            if (streamRef.current) {
              streamRef.current.scrollTop = streamRef.current.scrollHeight;
            }
          });
        }
      } catch (err: any) {
        if (initial) toast(err.message || 'Không tải được tin nhắn', true);
      } finally {
        if (initial) setLoadingMsgs(false);
      }
    },
    [serverId, activeDmUserId, activeChannel?.id],
  );

  useEffect(() => {
    lastFetchedIdRef.current = null;
    setReplyTo(null);
    setEditingMsgId(null);
    setShowPins(false);
    void loadMessages(true);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadMessages(false);
    }, 3500);
    return () => clearInterval(timer);
  }, [loadMessages]);

  // Other members for @mention (excluding yourself `me.id` — "trừ bản thân")
  const mentionCandidates = useMemo(() => {
    const others = members.filter((m) => m.id !== me.id);
    if (!mentionState) return [];
    const q = fold(mentionState.q.trim());
    return others.filter((m) => !q || fold(m.name).includes(q) || fold(m.email).includes(q)).slice(0, 8);
  }, [members, me.id, mentionState]);

  const checkComposerMention = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /(^|[\s(])@([^\s@]*(?: [^\s@]*){0,2})$/.exec(before);
    if (!m) {
      setMentionState(null);
      return;
    }
    const start = caret - m[2].length - 1;
    setMentionState((prev) => {
      if (!prev || prev.q !== m[2]) setMentionPick(0);
      return { q: m[2], start, end: caret };
    });
  };

  const applyMention = (member: ChatMember) => {
    if (!mentionState) return;
    const next = `${draft.slice(0, mentionState.start)}@${member.name} ${draft.slice(mentionState.end)}`;
    setDraft(next);
    setMentionState(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        const pos = mentionState.start + member.name.length + 2;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const isDm = serverId === 'dm';
    if (isDm && !activeDmUserId) return;
    const chanKey = isDm ? 'dm' : activeChannel?.id || 'general';
    const recip = isDm ? activeDmUserId || undefined : undefined;
    setSending(true);
    try {
      const created = await api.sendChatMessage(text, chanKey, recip, replyTo?.id || null);
      setMessages((prev) => [...prev, created]);
      setDraft('');
      setReplyTo(null);
      setMentionState(null);
      requestAnimationFrame(() => {
        if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
        inputRef.current?.focus();
      });
    } catch (err: any) {
      toast(err.message || 'Không gửi được tin nhắn', true);
    } finally {
      setSending(false);
    }
  };

  const handleToggleReaction = async (msg: ChatMessage, emoji: string) => {
    try {
      const res = await api.updateChatMessage(msg.id, { reaction: emoji });
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, reactions: res.reactions } : m)));
    } catch (err: any) {
      toast(err.message, true);
    }
  };

  const handleTogglePin = async (msg: ChatMessage) => {
    try {
      const res = await api.updateChatMessage(msg.id, { pinned: !msg.pinned });
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, pinned: res.pinned } : m)));
      toast(res.pinned ? 'Đã ghim tin nhắn' : 'Đã bỏ ghim tin nhắn');
    } catch (err: any) {
      toast(err.message, true);
    }
  };

  const handleSaveEdit = async (msgId: string) => {
    const text = editingText.trim();
    if (!text) return;
    try {
      const res = await api.updateChatMessage(msgId, { message: text });
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, message: res.message } : m)));
      setEditingMsgId(null);
      setEditingText('');
    } catch (err: any) {
      toast(err.message, true);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!(await askConfirm('Xoá tin nhắn này?'))) return;
    try {
      await api.deleteChatMessage(msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (err: any) {
      toast(err.message, true);
    }
  };

  const handleClearHistory = async () => {
    const isDm = serverId === 'dm';
    const label = isDm ? `cuộc trò chuyện với ${activeDmMember?.name || ''}` : `kênh #${activeChannel?.name || 'general'}`;
    if (!(await askConfirm(`Xoá toàn bộ lịch sử tin nhắn trong ${label}?`))) return;
    try {
      await api.clearChatMessages(isDm ? 'dm' : activeChannel?.id || 'general', isDm ? activeDmUserId || undefined : undefined);
      setMessages([]);
      toast('Đã xoá lịch sử trò chuyện');
    } catch (err: any) {
      toast(err.message, true);
    }
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChanName.trim() || creatingBusy) return;
    setCreatingBusy(true);
    try {
      const targetServer = serverId === 'dm' ? 'company' : serverId;
      const created = await api.createChatChannel({
        serverId: targetServer,
        category: newChanCat.trim() || 'KÊNH CHUNG',
        name: newChanName.trim(),
        topic: newChanTopic.trim(),
      });
      setCustomChannels((prev) => [...prev, created]);
      if (serverId === 'dm') setServerId('company');
      setActiveChannelId(created.id);
      setCreatingChannel(null);
      setNewChanName('');
      setNewChanTopic('');
      toast(`Đã tạo kênh #${created.name}`);
    } catch (err: any) {
      toast(err.message, true);
    } finally {
      setCreatingBusy(false);
    }
  };

  const handleDeleteChannel = async (ch: BuiltinChannel) => {
    if (ch.builtin) return;
    if (!(await askConfirm(`Xoá kênh #${ch.name} và toàn bộ tin nhắn trong kênh?`))) return;
    try {
      await api.deleteChatChannel(ch.id);
      setCustomChannels((prev) => prev.filter((x) => x.id !== ch.id));
      if (activeChannelId === ch.id) setActiveChannelId( currentServerChannels[0]?.id || 'general');
      toast(`Đã xoá kênh #${ch.name}`);
    } catch (err: any) {
      toast(err.message, true);
    }
  };

  // Group channels by category
  const channelsByCategory = useMemo(() => {
    const map = new Map<string, BuiltinChannel[]>();
    for (const ch of currentServerChannels) {
      const list = map.get(ch.category) || [];
      list.push(ch);
      map.set(ch.category, list);
    }
    return [...map.entries()];
  }, [currentServerChannels]);

  // Filter messages by search query
  const filteredMessages = useMemo(() => {
    const q = fold(searchQuery.trim());
    if (!q) return messages;
    return messages.filter((m) => fold(m.message).includes(q) || fold(m.senderName).includes(q));
  }, [messages, searchQuery]);

  const pinnedMessages = useMemo(() => messages.filter((m) => m.pinned), [messages]);
  const msgById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const onlineMembers = useMemo(() => members.filter((m) => isUserOnline(m.lastActive)), [members]);
  const offlineMembers = useMemo(() => members.filter((m) => !isUserOnline(m.lastActive)), [members]);

  const filteredDmMembers = useMemo(() => {
    const q = fold(dmSearch.trim());
    return members.filter((m) => {
      if (dmFilter === 'online' && !isUserOnline(m.lastActive)) return false;
      if (dmFilter === 'unread' && !(unreadMap[m.id] > 0)) return false;
      if (q && !fold(m.name).includes(q) && !fold(m.email).includes(q)) return false;
      return true;
    });
  }, [members, dmSearch, dmFilter, unreadMap]);

  const totalDmUnread = useMemo(
    () => Object.entries(unreadMap).reduce((sum, [k, v]) => (k !== 'general' ? sum + (v || 0) : sum), 0),
    [unreadMap],
  );

  const currentServerTitle = useMemo(() => {
    if (serverId === 'dm') return 'Tin nhắn trực tiếp';
    if (serverId === 'company') return 'DMI Studio';
    return spaces.find((w) => w.id === serverId)?.name || 'Workspace';
  }, [serverId, spaces]);

  const renderMessageContent = (text: string) => {
    // Highlight @mentions and clickable URLs
    const parts = text.split(/(https?:\/\/[^\s<>"']+|@[A-Za-zÀ-ỹ0-9_.-]+(?: [A-Za-zÀ-ỹ0-9_.-]+){0,3})/g);
    return parts.map((part, idx) => {
      if (/^https?:\/\//i.test(part)) {
        return (
          <a key={idx} href={part} target="_blank" rel="noopener noreferrer" className="dc-msg-link">
            {part}
          </a>
        );
      }
      if (part.startsWith('@')) {
        const nameCandidate = part.slice(1).trim();
        const matchedMember = members.find((m) => m.name.toLowerCase() === nameCandidate.toLowerCase() || nameCandidate.toLowerCase().startsWith(m.name.toLowerCase()));
        if (matchedMember || part.slice(1).toLowerCase() === me.name.toLowerCase()) {
          return (
            <span key={idx} className="dc-mention-pill">
              {part}
            </span>
          );
        }
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <div className="dc-page" role="region" aria-label="Tin nhắn nội bộ (Discord)">
      {/* Column 1: Server / Brand Hub Rail */}
      <nav className="dc-servers" aria-label="Máy chủ và Tin nhắn trực tiếp">
        <button
          type="button"
          className={`dc-srv-btn dc-srv-dm${serverId === 'dm' ? ' is-active' : ''}`}
          onClick={() => setServerId('dm')}
          title="Tin nhắn trực tiếp (Direct Messages)"
          aria-label="Tin nhắn trực tiếp"
        >
          <span className="dc-srv-pill" />
          <Icon name="messenger" size={22} />
          {totalDmUnread > 0 && <span className="dc-srv-badge">{totalDmUnread > 99 ? '99+' : totalDmUnread}</span>}
        </button>

        <div className="dc-srv-sep" />

        <button
          type="button"
          className={`dc-srv-btn dc-srv-company${serverId === 'company' ? ' is-active' : ''}`}
          onClick={() => setServerId('company')}
          title="DMI Studio (Kênh chung công ty)"
          aria-label="DMI Studio"
        >
          <span className="dc-srv-pill" />
          <img src="/brand/mark.png" alt="DMI" className="dc-srv-img" />
          {(unreadMap.general || 0) > 0 && <span className="dc-srv-badge">{unreadMap.general}</span>}
        </button>

        {spaces.map((w) => {
          const active = serverId === w.id;
          return (
            <button
              key={w.id}
              type="button"
              className={`dc-srv-btn${active ? ' is-active' : ''}`}
              onClick={() => setServerId(w.id)}
              title={`${w.name}${w.customerName && w.customerName !== w.name ? ` · ${w.customerName}` : ''}`}
              aria-label={w.name}
            >
              <span className="dc-srv-pill" />
              {w.avatar ? (
                <img src={w.avatar} alt="" className="dc-srv-img" />
              ) : (
                <span className="dc-srv-initial">{(w.name.trim()[0] || 'W').toUpperCase()}</span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          className="dc-srv-btn dc-srv-add"
          onClick={() => {
            setNewChanCat(serverId === 'company' || serverId === 'dm' ? 'KÊNH CHUNG' : 'KÊNH NHÃN HÀNG');
            setCreatingChannel({ category: 'KÊNH CHUNG' });
          }}
          title="Tạo kênh trò chuyện mới"
          aria-label="Tạo kênh trò chuyện mới"
        >
          <Icon name="plus" size={18} />
        </button>
      </nav>

      {/* Column 2: Channels / Direct Messages Sidebar */}
      <aside className="dc-sidebar" aria-label="Danh sách kênh và hội thoại">
        <header className="dc-side-head">
          {serverId === 'dm' ? (
            <label className="dc-dm-search">
              <Icon name="search" size={14} />
              <input
                value={dmSearch}
                onChange={(e) => setDmSearch(e.target.value)}
                placeholder="Tìm thành viên…"
                aria-label="Tìm thành viên"
              />
              {dmSearch && (
                <button type="button" className="dc-clear-btn" onClick={() => setDmSearch('')}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </label>
          ) : (
            <div className="dc-srv-header-row">
              <h2 className="dc-srv-title" title={currentServerTitle}>{currentServerTitle}</h2>
              <button
                type="button"
                className="dc-icon-btn"
                onClick={() => {
                  setNewChanCat(serverId === 'company' ? 'KÊNH CHUNG' : 'KÊNH NHÃN HÀNG');
                  setCreatingChannel({ category: 'KÊNH CHUNG' });
                }}
                title="Tạo kênh mới"
                aria-label="Tạo kênh mới"
              >
                <Icon name="plus" size={15} />
              </button>
            </div>
          )}
        </header>

        <div className="dc-side-list">
          {serverId === 'dm' ? (
            <>
              <div className="dc-dm-filters" role="tablist" aria-label="Lọc tin nhắn trực tiếp">
                <button
                  type="button"
                  role="tab"
                  aria-selected={dmFilter === 'all'}
                  className={`dc-dm-filter${dmFilter === 'all' ? ' is-active' : ''}`}
                  onClick={() => setDmFilter('all')}
                >
                  Tất cả ({members.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={dmFilter === 'online'}
                  className={`dc-dm-filter${dmFilter === 'online' ? ' is-active' : ''}`}
                  onClick={() => setDmFilter('online')}
                >
                  Trực tuyến ({onlineMembers.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={dmFilter === 'unread'}
                  className={`dc-dm-filter${dmFilter === 'unread' ? ' is-active' : ''}`}
                  onClick={() => setDmFilter('unread')}
                >
                  Chưa đọc ({totalDmUnread})
                </button>
              </div>

              <div className="dc-cat-head">
                <span>TIN NHẮN TRỰC TIẾP</span>
              </div>

              {!filteredDmMembers.length ? (
                <p className="dc-side-empty">Không có thành viên nào phù hợp.</p>
              ) : (
                filteredDmMembers.map((m) => {
                  const online = isUserOnline(m.lastActive);
                  const unread = unreadMap[m.id] || 0;
                  const active = activeDmUserId === m.id;
                  const roleObj = m.teamRole ? roles.find((r) => r.id === m.teamRole) : null;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`dc-dm-row${active ? ' is-active' : ''}${unread > 0 ? ' is-unread' : ''}`}
                      onClick={() => setActiveDmUserId(m.id)}
                    >
                      <span className="dc-av-wrap">
                        <Avatar m={{ id: m.id, name: m.name }} size={32} />
                        <span className={`dc-status-dot${online ? ' is-online' : ''}`} />
                      </span>
                      <span className="dc-dm-meta">
                        <span className="dc-dm-name">{m.name}</span>
                        <span className="dc-dm-sub">
                          {m.lastMessage ? m.lastMessage : roleObj ? roleObj.name : formatOnlineStatus(m.lastActive)}
                        </span>
                      </span>
                      {unread > 0 && <span className="dc-unread-pill">{unread}</span>}
                    </button>
                  );
                })
              )}
            </>
          ) : (
            <>
              {channelsByCategory.map(([cat, chList]) => {
                const folded = !!foldedCats[cat];
                return (
                  <section key={cat} className="dc-cat-group">
                    <div className="dc-cat-head">
                      <button
                        type="button"
                        className="dc-cat-toggle"
                        onClick={() => setFoldedCats((prev) => ({ ...prev, [cat]: !prev[cat] }))}
                      >
                        <Icon name={folded ? 'right' : 'down'} size={11} />
                        <span>{cat}</span>
                      </button>
                      <button
                        type="button"
                        className="dc-cat-add"
                        title={`Tạo kênh trong ${cat}`}
                        onClick={() => {
                          setNewChanCat(cat);
                          setCreatingChannel({ category: cat });
                        }}
                      >
                        <Icon name="plus" size={13} />
                      </button>
                    </div>
                    {!folded &&
                      chList.map((ch) => {
                        const active = activeChannel?.id === ch.id;
                        const unread = ch.id === 'general' ? unreadMap.general || 0 : 0;
                        return (
                          <div key={ch.id} className={`dc-chan-row${active ? ' is-active' : ''}${unread > 0 ? ' is-unread' : ''}`}>
                            <button
                              type="button"
                              className="dc-chan-btn"
                              onClick={() => setActiveChannelId(ch.id)}
                              title={ch.topic || `#${ch.name}`}
                            >
                              <span className="dc-chan-hash">#</span>
                              <span className="dc-chan-name">{ch.name}</span>
                              {unread > 0 && <span className="dc-unread-pill">{unread}</span>}
                            </button>
                            {!ch.builtin && (
                              <button
                                type="button"
                                className="dc-chan-del"
                                title={`Xoá kênh #${ch.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteChannel(ch);
                                }}
                              >
                                <Icon name="x" size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </section>
                );
              })}
            </>
          )}
        </div>

        {/* Bottom User Bar (Discord style) */}
        <footer className="dc-me-bar">
          <button
            type="button"
            className="dc-me-profile"
            onClick={() => openProfile(me.id)}
            title="Xem hồ sơ của bạn"
          >
            <span className="dc-av-wrap">
              <Avatar m={{ id: me.id, userId: me.id, name: me.name || me.email, avatarAt: me.avatarAt }} size={32} />
              <span className="dc-status-dot is-online" />
            </span>
            <span className="dc-me-info">
              <b>{me.name}</b>
              <small>Đang trực tuyến</small>
            </span>
          </button>
          <button
            type="button"
            className="dc-icon-btn"
            onClick={() => openProfile(me.id)}
            title="Cài đặt hồ sơ"
            aria-label="Cài đặt hồ sơ"
          >
            <Icon name="gear" size={15} />
          </button>
        </footer>
      </aside>

      {/* Column 3: Main Chat Stage */}
      <main className="dc-stage">
        {/* Top Channel / DM Header */}
        <header className="dc-top">
          <div className="dc-top-left">
            {serverId === 'dm' ? (
              activeDmMember ? (
                <>
                  <span className="dc-top-at">@</span>
                  <b className="dc-top-title">{activeDmMember.name}</b>
                  <span className={`dc-status-dot${isUserOnline(activeDmMember.lastActive) ? ' is-online' : ''}`} />
                  <span className="dc-top-topic">{formatOnlineStatus(activeDmMember.lastActive)}</span>
                </>
              ) : (
                <b className="dc-top-title">Tin nhắn trực tiếp</b>
              )
            ) : (
              <>
                <span className="dc-top-hash">#</span>
                <b className="dc-top-title">{activeChannel?.name || 'general'}</b>
                {activeChannel?.topic && (
                  <>
                    <span className="dc-top-divider" />
                    <span className="dc-top-topic" title={activeChannel.topic}>{activeChannel.topic}</span>
                  </>
                )}
              </>
            )}
          </div>

          <div className="dc-top-right">
            <button
              type="button"
              className={`dc-icon-btn${showPins ? ' is-active' : ''}`}
              onClick={() => setShowPins((v) => !v)}
              title="Tin nhắn đã ghim"
              aria-label="Tin nhắn đã ghim"
            >
              <Icon name="tag" size={15} />
              {pinnedMessages.length > 0 && <span className="dc-top-pin-count">{pinnedMessages.length}</span>}
            </button>

            <label className="dc-top-search">
              <Icon name="search" size={14} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm trong hội thoại…"
                aria-label="Tìm trong hội thoại"
              />
              {searchQuery && (
                <button type="button" className="dc-clear-btn" onClick={() => setSearchQuery('')}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </label>

            <button
              type="button"
              className={`dc-icon-btn${showMembers ? ' is-active' : ''}`}
              onClick={() => setShowMembers((v) => !v)}
              title={showMembers ? 'Ẩn danh sách thành viên' : 'Hiện danh sách thành viên'}
              aria-label="Danh sách thành viên"
            >
              <Icon name="users" size={16} />
            </button>

            {(me.role === 'admin' || serverId === 'dm') && messages.length > 0 && (
              <button
                type="button"
                className="dc-icon-btn"
                onClick={() => void handleClearHistory()}
                title="Xoá lịch sử trò chuyện"
                aria-label="Xoá lịch sử trò chuyện"
              >
                <Icon name="trash" size={15} />
              </button>
            )}
          </div>
        </header>

        {/* Pinned Messages Drawer */}
        {showPins && (
          <div className="dc-pins-drawer" role="dialog" aria-label="Tin nhắn đã ghim">
            <header className="dc-pins-head">
              <b>Tin nhắn đã ghim ({pinnedMessages.length})</b>
              <button type="button" className="dc-icon-btn" onClick={() => setShowPins(false)}>
                <Icon name="x" size={14} />
              </button>
            </header>
            {!pinnedMessages.length ? (
              <p className="dc-pins-empty">Chưa có tin nhắn nào được ghim trong cuộc trò chuyện này.</p>
            ) : (
              <div className="dc-pins-list">
                {pinnedMessages.map((pm) => (
                  <div key={pm.id} className="dc-pin-card">
                    <div className="dc-pin-meta">
                      <Avatar m={{ id: pm.senderId, name: pm.senderName }} size={22} />
                      <b>{pm.senderName}</b>
                      <small>{formatChatTime(pm.createdAt)}</small>
                      <button
                        type="button"
                        className="dc-icon-btn"
                        title="Bỏ ghim"
                        onClick={() => void handleTogglePin(pm)}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                    <p className="dc-pin-body">{pm.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Messages Stream */}
        <div className="dc-stream" ref={streamRef}>
          {loadingMsgs ? (
            <BrandLoading label="Đang tải tin nhắn…" compact />
          ) : (
            <>
              {/* Discord Welcome Banner */}
              <div className="dc-welcome">
                <div className="dc-welcome-icon">
                  {serverId === 'dm' && activeDmMember ? (
                    <Avatar m={{ id: activeDmMember.id, name: activeDmMember.name }} size={56} />
                  ) : (
                    <span>#</span>
                  )}
                </div>
                <h3>
                  {serverId === 'dm'
                    ? activeDmMember
                      ? activeDmMember.name
                      : 'Chọn một thành viên để trò chuyện'
                    : `Chào mừng bạn đến với #${activeChannel?.name || 'general'}!`}
                </h3>
                <p>
                  {serverId === 'dm'
                    ? activeDmMember
                      ? `Đây là khởi đầu cuộc trò chuyện trực tiếp của bạn với ${activeDmMember.name}.`
                      : 'Chọn một đồng nghiệp ở cột bên trái để bắt đầu nhắn tin.'
                    : activeChannel?.topic || `Đây là khởi đầu của kênh #${activeChannel?.name || 'general'}.`}
                </p>
              </div>

              {filteredMessages.map((msg, idx) => {
                const prev = idx > 0 ? filteredMessages[idx - 1] : null;
                const msgDate = new Date(msg.createdAt).toLocaleDateString('vi-VN', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                });
                const prevDate = prev
                  ? new Date(prev.createdAt).toLocaleDateString('vi-VN', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })
                  : null;
                const showDateSep = msgDate !== prevDate;
                const grouped =
                  !showDateSep &&
                  !msg.replyToId &&
                  prev !== null &&
                  prev.senderId === msg.senderId &&
                  msg.createdAt - prev.createdAt < 5 * 60 * 1000;

                const repliedMsg = msg.replyToId ? msgById.get(msg.replyToId) : null;
                const senderRoleObj = msg.senderRole ? roles.find((r) => r.id === msg.senderRole) : null;
                const reactionEntries = Object.entries(msg.reactions || {}).filter(([, ids]) => ids.length > 0);

                return (
                  <div key={msg.id}>
                    {showDateSep && (
                      <div className="dc-date-sep">
                        <span>{msgDate}</span>
                      </div>
                    )}

                    <article className={`dc-msg${grouped ? ' is-grouped' : ''}${msg.pinned ? ' is-pinned' : ''}`}>
                      {repliedMsg && (
                        <div className="dc-msg-reply-ref">
                          <span className="dc-reply-spine" />
                          <Avatar m={{ id: repliedMsg.senderId, name: repliedMsg.senderName }} size={16} />
                          <b>@{repliedMsg.senderName}</b>
                          <span className="dc-reply-preview">{repliedMsg.message}</span>
                        </div>
                      )}

                      <div className="dc-msg-row">
                        {grouped ? (
                          <span className="dc-msg-gutter-time">
                            {new Date(msg.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="dc-msg-av"
                            onClick={() => openProfile(msg.senderId)}
                            title={`Xem hồ sơ ${msg.senderName}`}
                          >
                            <Avatar
                              m={{ id: msg.senderId, userId: msg.senderId, name: msg.senderName, avatarAt: msg.senderAvatarAt }}
                              size={38}
                            />
                          </button>
                        )}

                        <div className="dc-msg-main">
                          {!grouped && (
                            <header className="dc-msg-head">
                              <button
                                type="button"
                                className="dc-msg-author"
                                onClick={() => openProfile(msg.senderId)}
                              >
                                {msg.senderName}
                              </button>
                              {senderRoleObj && (
                                <span
                                  className="dc-role-badge"
                                  style={{ '--role-c': senderRoleObj.color } as React.CSSProperties}
                                >
                                  {senderRoleObj.name}
                                </span>
                              )}
                              <time className="dc-msg-time">{formatChatTime(msg.createdAt)}</time>
                              {msg.pinned && <span className="dc-pin-tag">📌 Đã ghim</span>}
                            </header>
                          )}

                          {editingMsgId === msg.id ? (
                            <div className="dc-msg-edit">
                              <textarea
                                autoFocus
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                rows={2}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleSaveEdit(msg.id);
                                  }
                                  if (e.key === 'Escape') {
                                    setEditingMsgId(null);
                                    setEditingText('');
                                  }
                                }}
                              />
                              <div className="dc-msg-edit-foot">
                                <span>Nhấn Enter để lưu · Esc để huỷ</span>
                                <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleSaveEdit(msg.id)}>
                                  Lưu
                                </button>
                                <button type="button" className="btn btn-gray btn-sm" onClick={() => setEditingMsgId(null)}>
                                  Huỷ
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="dc-msg-text">{renderMessageContent(msg.message)}</div>
                          )}

                          {reactionEntries.length > 0 && (
                            <div className="dc-reactions">
                              {reactionEntries.map(([emoji, userIds]) => {
                                const mine = userIds.includes(me.id);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className={`dc-reaction-chip${mine ? ' is-mine' : ''}`}
                                    onClick={() => void handleToggleReaction(msg, emoji)}
                                  >
                                    <span>{emoji}</span>
                                    <b>{userIds.length}</b>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Discord Hover Action Toolbar */}
                      <div className="dc-msg-actions" role="toolbar" aria-label="Thao tác tin nhắn">
                        {QUICK_REACTIONS.slice(0, 4).map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            className="dc-act-btn"
                            title={`Thả ${emoji}`}
                            onClick={() => void handleToggleReaction(msg, emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="dc-act-btn"
                          title="Trả lời"
                          onClick={() => {
                            setReplyTo(msg);
                            inputRef.current?.focus();
                          }}
                        >
                          ↩
                        </button>
                        <button
                          type="button"
                          className="dc-act-btn"
                          title={msg.pinned ? 'Bỏ ghim' : 'Ghim tin nhắn'}
                          onClick={() => void handleTogglePin(msg)}
                        >
                          📌
                        </button>
                        {(msg.isMe || me.role === 'admin') && (
                          <>
                            {msg.isMe && (
                              <button
                                type="button"
                                className="dc-act-btn"
                                title="Sửa tin nhắn"
                                onClick={() => {
                                  setEditingMsgId(msg.id);
                                  setEditingText(msg.message);
                                }}
                              >
                                <Icon name="edit" size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="dc-act-btn is-danger"
                              title="Xoá tin nhắn"
                              onClick={() => void handleDeleteMessage(msg.id)}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Discord Composer Bar */}
        <div className="dc-composer-wrap">
          {replyTo && (
            <div className="dc-reply-banner">
              <span>
                Đang trả lời <b>@{replyTo.senderName}</b>: {replyTo.message.slice(0, 80)}
              </span>
              <button type="button" className="dc-clear-btn" onClick={() => setReplyTo(null)} aria-label="Huỷ trả lời">
                <Icon name="x" size={12} />
              </button>
            </div>
          )}

          {mentionState && mentionCandidates.length > 0 && (
            <ul className="dc-mention-menu" role="listbox" aria-label="Nhắc tên thành viên (trừ bản thân)">
              <li className="dc-mention-head">NHẮC TÊN THÀNH VIÊN</li>
              {mentionCandidates.map((m, idx) => (
                <li
                  key={m.id}
                  role="option"
                  aria-selected={idx === mentionPick}
                  className={`dc-mention-item${idx === mentionPick ? ' is-active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(m);
                  }}
                  onMouseEnter={() => setMentionPick(idx)}
                >
                  <Avatar m={{ id: m.id, name: m.name }} size={24} />
                  <b>{m.name}</b>
                  <small>{m.email}</small>
                </li>
              ))}
            </ul>
          )}

          {emojiOpen && (
            <div className="dc-emoji-pop">
              {EMOJI_PALETTE.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => {
                    setDraft((prev) => prev + em);
                    setEmojiOpen(false);
                    inputRef.current?.focus();
                  }}
                >
                  {em}
                </button>
              ))}
            </div>
          )}

          <div className="dc-composer">
            <button
              type="button"
              className="dc-comp-btn"
              title="Nhắc tên thành viên (@)"
              onClick={() => {
                const next = draft.endsWith(' ') || !draft ? `${draft}@` : `${draft} @`;
                setDraft(next);
                checkComposerMention(next, next.length);
                inputRef.current?.focus();
              }}
            >
              <b>@</b>
            </button>

            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              disabled={sending || (serverId === 'dm' && !activeDmMember)}
              placeholder={
                serverId === 'dm'
                  ? activeDmMember
                    ? `Nhắn tin tới @${activeDmMember.name} (gõ @ để nhắc tên)…`
                    : 'Chọn một thành viên để nhắn tin…'
                  : `Nhắn tin tới #${activeChannel?.name || 'general'} (gõ @ để nhắc tên)…`
              }
              onChange={(e) => {
                setDraft(e.target.value);
                checkComposerMention(e.target.value, e.target.selectionStart || 0);
              }}
              onClick={(e) => checkComposerMention(e.currentTarget.value, e.currentTarget.selectionStart || 0)}
              onKeyDown={(e) => {
                if (mentionState && mentionCandidates.length > 0) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionPick(
                      (mentionPick + (e.key === 'ArrowDown' ? 1 : mentionCandidates.length - 1)) %
                        mentionCandidates.length,
                    );
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    applyMention(mentionCandidates[Math.min(mentionPick, mentionCandidates.length - 1)]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setMentionState(null);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />

            <button
              type="button"
              className="dc-comp-btn"
              title="Chọn biểu tượng cảm xúc"
              onClick={() => setEmojiOpen((v) => !v)}
            >
              😀
            </button>

            <button
              type="button"
              className="btn btn-primary btn-sm dc-send-btn"
              disabled={!draft.trim() || sending || (serverId === 'dm' && !activeDmMember)}
              onClick={() => void handleSend()}
            >
              <Icon name="send" size={14} />
              <span>Gửi</span>
            </button>
          </div>
        </div>
      </main>

      {/* Column 4: Right Member List / Profile Panel */}
      {showMembers && (
        <aside className="dc-members" aria-label="Thành viên">
          {serverId === 'dm' && activeDmMember ? (
            <div className="dc-profile-card">
              <div className="dc-profile-banner" />
              <div className="dc-profile-av">
                <Avatar m={{ id: activeDmMember.id, name: activeDmMember.name }} size={64} />
                <span className={`dc-status-dot${isUserOnline(activeDmMember.lastActive) ? ' is-online' : ''}`} />
              </div>
              <div className="dc-profile-body">
                <h3>{activeDmMember.name}</h3>
                <p className="dc-profile-email">{activeDmMember.email}</p>
                <span className="dc-profile-status">{formatOnlineStatus(activeDmMember.lastActive)}</span>
                {activeDmMember.teamRole && (
                  <div className="dc-profile-sec">
                    <h4>PHÒNG BAN</h4>
                    <span className="dc-role-badge">
                      {roles.find((r) => r.id === activeDmMember.teamRole)?.name || 'Thành viên'}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-gray btn-sm bk-wide"
                  onClick={() => openProfile(activeDmMember.id)}
                >
                  Xem hồ sơ đầy đủ
                </button>
              </div>
            </div>
          ) : (
            <div className="dc-member-groups">
              <div className="dc-member-group">
                <h4>TRỰC TUYẾN — {onlineMembers.length + 1}</h4>
                <button type="button" className="dc-member-item" onClick={() => openProfile(me.id)}>
                  <span className="dc-av-wrap">
                    <Avatar m={{ id: me.id, userId: me.id, name: me.name || me.email, avatarAt: me.avatarAt }} size={30} />
                    <span className="dc-status-dot is-online" />
                  </span>
                  <span className="dc-member-info">
                    <b>{me.name} (bạn)</b>
                    <small>{me.role === 'admin' ? 'Super Admin' : 'Đang hoạt động'}</small>
                  </span>
                </button>
                {onlineMembers.map((m) => {
                  const r = m.teamRole ? roles.find((x) => x.id === m.teamRole) : null;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className="dc-member-item"
                      onClick={() => {
                        setServerId('dm');
                        setActiveDmUserId(m.id);
                      }}
                      title={`Nhắn tin trực tiếp cho ${m.name}`}
                    >
                      <span className="dc-av-wrap">
                        <Avatar m={{ id: m.id, name: m.name }} size={30} />
                        <span className="dc-status-dot is-online" />
                      </span>
                      <span className="dc-member-info">
                        <b>{m.name}</b>
                        <small>{r ? r.name : 'Đang hoạt động'}</small>
                      </span>
                    </button>
                  );
                })}
              </div>

              {offlineMembers.length > 0 && (
                <div className="dc-member-group">
                  <h4>NGOẠI TUYẾN — {offlineMembers.length}</h4>
                  {offlineMembers.map((m) => {
                    const r = m.teamRole ? roles.find((x) => x.id === m.teamRole) : null;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className="dc-member-item is-offline"
                        onClick={() => {
                          setServerId('dm');
                          setActiveDmUserId(m.id);
                        }}
                        title={`Nhắn tin trực tiếp cho ${m.name}`}
                      >
                        <span className="dc-av-wrap">
                          <Avatar m={{ id: m.id, name: m.name }} size={30} />
                          <span className="dc-status-dot" />
                        </span>
                        <span className="dc-member-info">
                          <b>{m.name}</b>
                          <small>{r ? r.name : formatOnlineStatus(m.lastActive)}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </aside>
      )}

      {/* Create Channel Modal */}
      {creatingChannel && (
        <div className="bd-modal" onMouseDown={(e) => e.target === e.currentTarget && !creatingBusy && setCreatingChannel(null)}>
          <form className="bd-create" onSubmit={handleCreateChannel}>
            <header>
              <b>Tạo kênh trò chuyện mới</b>
              <button type="button" className="bd-icon" disabled={creatingBusy} onClick={() => setCreatingChannel(null)}>
                <Icon name="x" size={15} />
              </button>
            </header>
            <label className="bd-label">Danh mục nhóm kênh</label>
            <input
              value={newChanCat}
              onChange={(e) => setNewChanCat(e.target.value)}
              placeholder="Ví dụ: KÊNH CHUNG, CHIẾN DỊCH…"
            />
            <label className="bd-label">Tên kênh <em>*</em></label>
            <input
              autoFocus
              required
              value={newChanName}
              onChange={(e) => setNewChanName(e.target.value)}
              placeholder="Ví dụ: bao-cao-tuan, kich-ban-video"
            />
            <label className="bd-label">Mô tả chủ đề (không bắt buộc)</label>
            <input
              value={newChanTopic}
              onChange={(e) => setNewChanTopic(e.target.value)}
              placeholder="Kênh này dùng để trao đổi việc gì…"
            />
            <button className="btn btn-primary" disabled={!newChanName.trim() || creatingBusy}>
              {creatingBusy ? 'Đang tạo…' : 'Tạo kênh'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

