import type { ReactNode } from 'react';
import { ReviewShell, type ReviewContext, type ReviewTab } from '../components/Player';
import { useRouter } from '../router';
import { notesTab } from './Review';
import { askTab } from './ReviewAsk';
import { commentsTab } from './ReviewComments';
import { transcriptTab } from './ReviewTranscript';

const TABS: Record<ReviewTab, (ctx: ReviewContext) => ReactNode> = {
  Review: notesTab, ReviewTranscript: transcriptTab, ReviewComments: commentsTab, ReviewAsk: askTab,
};

export const isReviewTab = (screen: string): screen is ReviewTab => screen in TABS;

/** The four Review screens share one mounted player, so switching tabs keeps the video playing. */
export default function ReviewTabs() {
  const { route } = useRouter();
  const tab = isReviewTab(route.screen) ? route.screen : 'Review';
  return <ReviewShell tab={tab}>{TABS[tab]}</ReviewShell>;
}
