import { normName } from '../server/taskimport';
export type TaskBoardCategory = 'media' | 'content' | 'ads' | 'website' | 'account' | 'general';
/** Route by the work being done: a Paid Ads video still belongs to the media team. */
export function taskBoardCategory(title: string, project = ''): TaskBoardCategory {
  const t = normName(title), p = normName(project);
  if (/\b(video|voice|voiceover|footage|dung phim|dung video)\b/.test(t)) return 'media';
  if (/\b(content workbook|copywriting|caption|script|viet bai)\b/.test(t) || /^content\b/.test(t)) return 'content';
  if (/\b(website|wordpress|wp|dns|staging|theme|hosting|domain)\b/.test(t) || /^web\b/.test(t) || /\bdev daily\b/.test(p)) return 'website';
  if (/\bnoi dung\b/.test(t)) return 'content';
  if (/\b(paid ads|meta ads|lsa|seo|campaign|camp|quang cao)\b/.test(t)) return 'ads';
  if (/\b(account|sale|onboarding|khach moi|brief)\b/.test(t)) return 'account';
  return 'general';
}
