import { VoiceDemo } from '@/components/voice-demo/VoiceDemo';

export const metadata = {
  title: '语音交互演示 - AI 外呼机器人控制台',
  description: 'Python WebRTC VAD + FunASR 实时语音识别 + Qwen-TTS 云端语音合成演示',
};

export default function VoiceDemoPage() {
  return <VoiceDemo />;
}
