// Reactions on comments, as on Facebook: each person gives a comment at most one (Thích, Yêu thích, Haha, Wow, Buồn,
// Thương thương, Phẫn nộ); another replaces it, the same one again takes it back. Card comments and task comments
// alike, by the comment's id (server/boards.ts checks who may react).
import { all, run, now } from './db';
import { HttpError } from './http';

export const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'care', 'angry'] as const;
export type Reaction = (typeof REACTIONS)[number];
export interface ReactionOut { r: Reaction; userId: string; name: string }

/** Every reaction on these comments, oldest first, by comment id. */
export async function reactionsOf(ids: string[]): Promise<Map<string, ReactionOut[]>> {
  const out = new Map<string, ReactionOut[]>();
  if (!ids.length) return out;
  for (const r of await all<any>('SELECT x.comment_id, x.reaction, x.user_id, u.name FROM comment_reactions x LEFT JOIN users u ON u.id = x.user_id WHERE x.comment_id IN (SELECT value FROM json_each(?)) ORDER BY x.created_at', JSON.stringify(ids))) {
    const list = out.get(r.comment_id) || [];
    list.push({ r: r.reaction, userId: r.user_id, name: r.name || 'Ai đó' });
    out.set(r.comment_id, list);
  }
  return out;
}
/** Sets (or with null takes back) this person's reaction; the comment's reactions after it. */
export async function react(commentId: string, userId: string, reaction: unknown) {
  if (reaction === null || reaction === undefined || reaction === '') await run('DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ?', commentId, userId);
  else {
    const r = String(reaction) as Reaction;
    if (!REACTIONS.includes(r)) throw new HttpError(400, 'Cảm xúc không hợp lệ');
    await run('INSERT INTO comment_reactions(comment_id, user_id, reaction, created_at) VALUES(?,?,?,?) ON CONFLICT(comment_id, user_id) DO UPDATE SET reaction = excluded.reaction', commentId, userId, r, now());
  }
  return (await reactionsOf([commentId])).get(commentId) || [];
}
/** A comment deleted takes its reactions with it. */
export const dropReactions = (commentId: string) => run('DELETE FROM comment_reactions WHERE comment_id = ?', commentId);
