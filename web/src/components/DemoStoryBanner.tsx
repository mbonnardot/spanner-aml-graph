import { useState } from 'react';
import { Button, Tag } from '@carbon/react';
import {
  ChevronDown,
  ChevronUp,
  Code,
  Copy,
  Education,
} from '@carbon/icons-react';
import type { EnrichedCaseInvestigation } from '../types/aml';

export interface DemoStoryBannerProps {
  readonly investigation: EnrichedCaseInvestigation | null;
}

type BannerMode = 'guide' | 'gql' | 'collapsed';

export function DemoStoryBanner({ investigation }: DemoStoryBannerProps) {
  const [mode, setMode] = useState<BannerMode>('guide');
  const [copied, setCopied] = useState<boolean>(false);

  const guide = investigation?.demo_guide;
  if (!investigation || !guide) {
    return null;
  }

  const anchorAccountId = investigation.evidence.account_ids[0] ?? 'N/A';

  const handleCopyGql = async () => {
    try {
      await navigator.clipboard.writeText(guide.gql_query);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable in non-secure context
    }
  };

  return (
    <div className="demo-story-banner">
      <div className="demo-story-banner__bar">
        <div className="demo-story-banner__title-group">
          <Tag type="cyan" size="sm">
            DEMO GUIDE
          </Tag>
          <span className="demo-story-banner__nickname">{guide.nickname}</span>
          <span className="demo-story-banner__param">
            @account_id=&apos;{anchorAccountId}&apos;
          </span>
        </div>

        <div className="demo-story-banner__actions">
          <Button
            kind={mode === 'guide' ? 'primary' : 'ghost'}
            size="sm"
            renderIcon={Education}
            onClick={() => setMode(mode === 'guide' ? 'collapsed' : 'guide')}
          >
            Plain-English Story
          </Button>
          <Button
            kind={mode === 'gql' ? 'primary' : 'ghost'}
            size="sm"
            renderIcon={Code}
            onClick={() => setMode(mode === 'gql' ? 'collapsed' : 'gql')}
          >
            Live Spanner ISO GQL
          </Button>
          <Button
            kind="ghost"
            size="sm"
            hasIconOnly
            iconDescription={
              mode === 'collapsed' ? 'Expand Demo Guide' : 'Collapse Demo Guide'
            }
            renderIcon={mode === 'collapsed' ? ChevronDown : ChevronUp}
            onClick={() =>
              setMode(mode === 'collapsed' ? 'guide' : 'collapsed')
            }
          />
        </div>
      </div>

      {mode === 'guide' && (
        <div className="demo-story-banner__grid">
          <div className="demo-story-card demo-story-card--playbook">
            <div className="demo-story-card__eyebrow">
              1. Criminal Playbook (What&apos;s Happening in Plain English)
            </div>
            <p className="demo-story-card__body">{guide.plain_english}</p>
          </div>
          <div className="demo-story-card demo-story-card--spanner">
            <div className="demo-story-card__eyebrow">
              2. Why Cloud Spanner Graph Wins (Zero ETL + ISO GQL)
            </div>
            <p className="demo-story-card__body">{guide.why_spanner_wins}</p>
          </div>
        </div>
      )}

      {mode === 'gql' && (
        <div className="demo-story-gql">
          <div className="demo-story-gql__header">
            <span>
              Executed on <strong>GRAPH AmlGraph</strong> in{' '}
              <strong>
                {investigation.evidence.query_latency_ms.toFixed(1)} ms
              </strong>{' '}
              (Zero ETL — directly on operational Spanner tables)
            </span>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Copy}
              onClick={() => void handleCopyGql()}
            >
              {copied ? 'Copied!' : 'Copy ISO GQL'}
            </Button>
          </div>
          <pre className="demo-story-gql__code">{guide.gql_query}</pre>
        </div>
      )}
    </div>
  );
}
