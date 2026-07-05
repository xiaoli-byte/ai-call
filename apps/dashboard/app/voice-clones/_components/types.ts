export type CloneWorkbenchStatus = 'idle' | 'recording' | 'ready' | 'generating' | 'preview' | 'saved';

export type CaptureKind = 'recorded' | 'uploaded';

export type VoiceCloneModelOption = {
  id: string;
  name: string;
  badge: string;
  description: string;
  tags: string[];
};
