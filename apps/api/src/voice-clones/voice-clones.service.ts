import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { VoiceCloneModel, VoiceCloneStatus, type VoiceClone, type VoiceCloneSynthesisResult } from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateVoiceCloneDto } from './dto/create-voice-clone.dto.js';
import type { CreateVoiceClonePreviewDto } from './dto/create-voice-clone-preview.dto.js';
import type { SynthesizeVoiceCloneDto } from './dto/synthesize-voice-clone.dto.js';

type VoiceCloneRecord = {
  id: string;
  voiceId: string;
  name: string;
  model: string;
  promptText: string;
  description: string;
  status: string;
  sourceFilename: string;
  sourceMimeType: string;
  sourceFilePath: string;
  sourceFileSize: number;
  previewText: string | null;
  previewFilePath: string | null;
  previewMimeType: string | null;
  previewGeneratedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type AudioKind = 'source' | 'preview';

type AudioFile = {
  stream: Readable;
  mimeType: string;
  filename: string;
  size: number;
};

type GeneratedAudio = {
  buffer: Buffer;
  mimeType: string;
  voiceId?: string;
};

const ALLOWED_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac']);
const ALLOWED_MIME_PREFIXES = ['audio/', 'video/mp4', 'application/octet-stream'];
const DEFAULT_PREVIEW_TEXT = '您好，这里是客户满意度调研中心，感谢您选择我们的服务。请问是王先生吗？';

@Injectable()
export class VoiceClonesService {
  private readonly storageRoot = process.env.VOICE_CLONE_STORAGE_DIR
    ? resolve(process.env.VOICE_CLONE_STORAGE_DIR)
    : resolveWorkspacePath('.runtime', 'voice-clones');
  private readonly cosyVoiceBaseUrl = process.env.COSYVOICE_BASE_URL?.replace(/\/+$/, '');
  private readonly cosyVoiceSampleRate = Number(process.env.COSYVOICE_SAMPLE_RATE ?? 24000);
  private readonly cosyVoiceTimeoutMs = Number(process.env.COSYVOICE_TIMEOUT_MS ?? 30000);
  // 云端 CosyVoice 声音复刻绑定的合成模型（复刻创建与后续合成须用同一模型）。
  private readonly cosyVoiceCloneTargetModel = process.env.COSYVOICE_CLONE_TARGET_MODEL?.trim() || 'cosyvoice-v2';
  private readonly dashScopeApiKey = process.env.DASHSCOPE_API_KEY ?? '';
  private readonly dashScopeBaseUrl = resolveDashScopeBaseUrl();
  private readonly dashScopeTimeoutMs = Number(process.env.DASHSCOPE_TTS_TIMEOUT_MS ?? 60000);
  private readonly qwenVoiceCloneModel = process.env.QWEN_VOICE_CLONE_MODEL ?? 'qwen-voice-enrollment';
  private readonly qwenVoiceCloneTargetModel = process.env.QWEN_VOICE_CLONE_TARGET_MODEL?.trim() || 'qwen3-tts-vc-realtime-2026-01-15';
  private readonly qwenVoiceCloneLanguage = process.env.QWEN_VOICE_CLONE_LANGUAGE ?? 'zh';
  private readonly qwenTtsLanguageType = process.env.QWEN_TTS_LANGUAGE_TYPE ?? 'Chinese';

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<VoiceClone[]> {
    const records = await this.prisma.voiceClone.findMany({
      where: { status: VoiceCloneStatus.READY },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return records.map((record) => this.toDomain(record));
  }

  async get(identifier: string): Promise<VoiceClone> {
    return this.toDomain(await this.findRecord(identifier));
  }

  async create(
    dto: CreateVoiceCloneDto,
    file: Express.Multer.File | undefined,
  ): Promise<VoiceClone> {
    const record = await this.createRecord(dto, file, VoiceCloneStatus.READY);
    return this.toDomain(record);
  }

  async createPreview(
    dto: CreateVoiceClonePreviewDto,
    file: Express.Multer.File | undefined,
  ): Promise<VoiceCloneSynthesisResult> {
    const record = await this.createRecord(
      {
        voiceId: dto.voiceId,
        name: dto.name,
        model: dto.model,
        promptText: dto.previewText,
        description: dto.description,
      },
      file,
      VoiceCloneStatus.PREVIEW,
    );

    try {
      return await this.synthesize(record.id, { text: dto.previewText });
    } catch (err) {
      await this.prisma.voiceClone.update({
        where: { id: record.id },
        data: { status: VoiceCloneStatus.FAILED },
      }).catch(() => undefined);
      throw err;
    }
  }

  async synthesize(identifier: string, dto: SynthesizeVoiceCloneDto): Promise<VoiceCloneSynthesisResult> {
    const record = await this.updatePreviewDraft(await this.findRecord(identifier), dto);
    const trimmedText = dto.text.trim() || DEFAULT_PREVIEW_TEXT;
    const model = normalizeModel(record.model);

    try {
      const audio = model === VoiceCloneModel.COSYVOICE
        ? await this.requestCosyVoicePreview(record, trimmedText)
        : await this.requestQwenVoiceClonePreview(record, trimmedText);
      const previewRelativePath = `${record.id}/preview${extensionForPreview(audio.mimeType, audio.buffer)}`;
      await this.writeStorageFile(previewRelativePath, audio.buffer);
      const data: Partial<VoiceCloneRecord> = {
        previewText: trimmedText,
        previewFilePath: previewRelativePath,
        previewMimeType: audio.mimeType,
        previewGeneratedAt: new Date(),
      };
      if (audio.voiceId && audio.voiceId !== record.voiceId) {
        data.voiceId = audio.voiceId;
      }
      const updated = await this.prisma.voiceClone.update({
        where: { id: record.id },
        data,
      });
      return { voiceClone: this.toDomain(updated), usedFallback: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (process.env.VOICE_CLONE_PREVIEW_FALLBACK === 'true') {
        return this.useReferenceAsPreview(record, trimmedText, `${formatModelName(model)} 试听合成失败，暂用提示音频作为试听：${message}`);
      }
      throw new BadGatewayException(`${formatModelName(model)} 试听合成失败：${message}`);
    }
  }

  async confirm(identifier: string): Promise<VoiceClone> {
    const record = await this.findRecord(identifier);
    if (record.status === VoiceCloneStatus.READY) return this.toDomain(record);
    if (record.status !== VoiceCloneStatus.PREVIEW) {
      throw new BadRequestException('仅可确认试听中的音色');
    }
    const updated = await this.prisma.voiceClone.update({
      where: { id: record.id },
      data: { status: VoiceCloneStatus.READY },
    });
    return this.toDomain(updated);
  }

  async getAudio(identifier: string, kind: AudioKind): Promise<AudioFile> {
    const record = await this.findRecord(identifier);
    const usePreview = kind === 'preview' && record.previewFilePath;
    const relativePath = usePreview ? record.previewFilePath! : record.sourceFilePath;
    const fullPath = this.resolveStoragePath(relativePath);
    const stats = await stat(fullPath).catch(() => null);
    if (!stats?.isFile()) throw new NotFoundException('音频文件不存在');
    return {
      stream: createReadStream(fullPath),
      mimeType: usePreview
        ? record.previewMimeType ?? 'audio/wav'
        : record.sourceMimeType,
      filename: usePreview
        ? `${record.voiceId}-preview${extname(relativePath) || '.wav'}`
        : record.sourceFilename,
      size: stats.size,
    };
  }

  async remove(identifier: string): Promise<void> {
    const record = await this.findRecord(identifier);
    await this.prisma.voiceClone.delete({ where: { id: record.id } });
    await rm(this.resolveStoragePath(record.id), { recursive: true, force: true });
  }

  private async findRecord(identifier: string): Promise<VoiceCloneRecord> {
    const record = await this.prisma.voiceClone.findFirst({
      where: { OR: [{ id: identifier }, { voiceId: identifier }] },
    });
    if (!record) throw new NotFoundException(`Voice clone ${identifier} not found`);
    return record;
  }

  private async createRecord(
    dto: {
      voiceId?: string;
      name: string;
      model?: string;
      promptText: string;
      description?: string;
    },
    file: Express.Multer.File | undefined,
    status: VoiceCloneStatus,
  ): Promise<VoiceCloneRecord> {
    if (!file) throw new BadRequestException('请上传提示音频文件');
    this.assertAudioFile(file);

    const voiceId = await this.resolveVoiceId(dto.voiceId);

    const id = randomUUID();
    const extension = normalizeExtension(file.originalname, file.mimetype);
    const relativePath = `${id}/source${extension}`;
    await this.writeStorageFile(relativePath, file.buffer);

    return this.prisma.voiceClone.create({
      data: {
        id,
        voiceId,
        name: dto.name.trim(),
        model: normalizeModel(dto.model),
        promptText: dto.promptText.trim(),
        description: dto.description?.trim() ?? '',
        status,
        sourceFilename: normalizeOriginalFilename(file.originalname) || `source${extension}`,
        sourceMimeType: normalizeMimeType(file.mimetype, extension),
        sourceFilePath: relativePath,
        sourceFileSize: file.size,
      },
    });
  }

  private async updatePreviewDraft(
    record: VoiceCloneRecord,
    dto: SynthesizeVoiceCloneDto,
  ): Promise<VoiceCloneRecord> {
    const next: {
      name?: string;
      model?: string;
      description?: string;
    } = {};

    if (dto.name !== undefined) next.name = dto.name.trim();
    if (dto.model !== undefined) next.model = normalizeModel(dto.model);
    if (dto.description !== undefined) next.description = dto.description.trim();

    const hasDraftUpdates = Object.keys(next).length > 0;
    if (!hasDraftUpdates) return record;
    if (record.status !== VoiceCloneStatus.PREVIEW) {
      throw new BadRequestException('已加入音色库的音色不支持编辑，请重新克隆');
    }

    if (next.name !== undefined && !next.name) {
      throw new BadRequestException('请填写音色名称');
    }
    return this.prisma.voiceClone.update({
      where: { id: record.id },
      data: next,
    });
  }

  private async useReferenceAsPreview(
    record: VoiceCloneRecord,
    text: string,
    message: string,
  ): Promise<VoiceCloneSynthesisResult> {
    const updated = await this.prisma.voiceClone.update({
      where: { id: record.id },
      data: {
        previewText: text,
        previewFilePath: record.sourceFilePath,
        previewMimeType: record.sourceMimeType,
        previewGeneratedAt: new Date(),
      },
    });
    return {
      voiceClone: this.toDomain(updated),
      usedFallback: true,
      message,
    };
  }

  private async resolveVoiceId(requestedVoiceId?: string): Promise<string> {
    const trimmed = requestedVoiceId?.trim();
    if (trimmed) {
      const existing = await this.prisma.voiceClone.findUnique({
        where: { voiceId: trimmed },
        select: { id: true },
      });
      if (existing) throw new ConflictException(`音色 ID ${trimmed} 已存在`);
      return trimmed;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const generated = `voice_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const existing = await this.prisma.voiceClone.findUnique({
        where: { voiceId: generated },
        select: { id: true },
      });
      if (!existing) return generated;
    }
    throw new ConflictException('自动生成音色 ID 失败，请重试');
  }

  private async requestQwenVoiceClonePreview(
    record: VoiceCloneRecord,
    text: string,
  ): Promise<GeneratedAudio> {
    const voiceId = isLocalDraftVoiceId(record.voiceId)
      ? await this.createDashScopeQwenVoice(record)
      : record.voiceId;
    // realtime 复刻音色（vc-realtime）绑定到 WebSocket 流式模型，只能在实时通话
    // （voice-agent）里合成；dashboard 侧的 HTTP 非流式试听接口不支持该模型。
    // 此时跳过 HTTP 试听、用源音频作试听兜底，确保音色照常创建入库供通话使用。
    if (isRealtimeQwenTargetModel(this.qwenVoiceCloneTargetModel)) {
      const source = await readFile(this.resolveStoragePath(record.sourceFilePath));
      return { buffer: source, mimeType: record.sourceMimeType, voiceId };
    }
    const audio = await this.synthesizeDashScopeQwenVoice(voiceId, text);
    return { ...audio, voiceId };
  }

  private async createDashScopeQwenVoice(record: VoiceCloneRecord): Promise<string> {
    if (!this.dashScopeApiKey) {
      throw new Error('未配置 DASHSCOPE_API_KEY，无法调用 Qwen 声音复刻');
    }
    // 复刻音色的创建接口（customization/create）接受 realtime target_model，
    // 音色即绑定到该模型；不在此拦截 realtime（仅 HTTP 合成路径不支持，见下）。
    const promptAudio = await readFile(this.resolveStoragePath(record.sourceFilePath));
    const response = await this.requestDashScopeJson(`${this.dashScopeBaseUrl}/services/audio/tts/customization`, {
      model: this.qwenVoiceCloneModel,
      input: {
        action: 'create',
        target_model: this.qwenVoiceCloneTargetModel,
        preferred_name: buildPreferredVoiceName(record),
        language: this.qwenVoiceCloneLanguage,
        audio: {
          data: `data:${record.sourceMimeType};base64,${promptAudio.toString('base64')}`,
        },
      },
    });

    const voice = readNestedString(response, ['output', 'voice']) ??
      readNestedString(response, ['output', 'voice_id']) ??
      readNestedString(response, ['output', 'voiceId']);
    if (!voice) {
      throw new Error(`Qwen 声音复刻未返回 voice：${JSON.stringify(response).slice(0, 300)}`);
    }
    return voice;
  }

  private async synthesizeDashScopeQwenVoice(
    voiceId: string,
    text: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    assertHttpQwenVoiceCloneTargetModel(this.qwenVoiceCloneTargetModel);
    const response = await this.requestDashScopeJson(`${this.dashScopeBaseUrl}/services/aigc/multimodal-generation/generation`, {
      model: this.qwenVoiceCloneTargetModel,
      input: {
        text,
        voice: voiceId,
        language_type: this.qwenTtsLanguageType,
      },
    });

    const audioData = readNestedString(response, ['output', 'audio', 'data']);
    if (audioData) return decodeDashScopeAudioData(audioData);

    const audioUrl = readNestedString(response, ['output', 'audio', 'url']);
    if (!audioUrl) {
      throw new Error(`Qwen TTS 未返回音频地址：${JSON.stringify(response).slice(0, 300)}`);
    }
    return this.downloadDashScopeAudio(audioUrl);
  }

  private async downloadDashScopeAudio(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(Math.min(120_000, Math.max(5_000, this.dashScopeTimeoutMs))),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Qwen TTS 音频下载失败 HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error('Qwen TTS 返回空音频');
    return {
      buffer,
      mimeType: normalizeGeneratedAudioMimeType(response.headers.get('content-type'), url, buffer),
    };
  }

  private async requestDashScopeJson(url: string, body: unknown): Promise<unknown> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.dashScopeApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(120_000, Math.max(5_000, this.dashScopeTimeoutMs))),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`DashScope HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`DashScope 返回非 JSON：${text.slice(0, 300)}`);
    }
  }

  private async requestCosyVoicePreview(
    record: VoiceCloneRecord,
    text: string,
  ): Promise<GeneratedAudio> {
    // 云端 CosyVoice：本地草稿 voiceId → 调 DashScope 声音复刻创建云端音色（绑定 target_model）。
    const voiceId = isLocalDraftVoiceId(record.voiceId)
      ? await this.createDashScopeCosyVoice(record)
      : record.voiceId;
    // 云端 CosyVoice 合成只有 WebSocket 流式接口（tts_v2），dashboard 侧 HTTP 试听
    // 不便直连；试听暂用源音频兜底，真实克隆效果在实时通话（voice-agent CosyVoice）中体验。
    const source = await readFile(this.resolveStoragePath(record.sourceFilePath));
    return { buffer: source, mimeType: record.sourceMimeType, voiceId };
  }

  private async createDashScopeCosyVoice(record: VoiceCloneRecord): Promise<string> {
    if (!this.dashScopeApiKey) {
      throw new Error('未配置 DASHSCOPE_API_KEY，无法调用 CosyVoice 声音复刻');
    }
    const promptAudio = await readFile(this.resolveStoragePath(record.sourceFilePath));
    // CosyVoice 复刻接口的 url 字段实测接受 base64 data URL，免公网音频托管。
    const dataUrl = `data:${record.sourceMimeType};base64,${promptAudio.toString('base64')}`;
    const response = await this.requestDashScopeJson(
      `${this.dashScopeBaseUrl}/services/audio/tts/customization`,
      {
        model: 'voice-enrollment',
        input: {
          action: 'create_voice',
          target_model: this.cosyVoiceCloneTargetModel,
          prefix: buildCosyVoicePrefix(record),
          url: dataUrl,
        },
      },
    );
    const voice =
      readNestedString(response, ['output', 'voice_id']) ??
      readNestedString(response, ['output', 'voice']);
    if (!voice) {
      throw new Error(`CosyVoice 声音复刻未返回 voice_id：${JSON.stringify(response).slice(0, 300)}`);
    }
    return voice;
  }

  private assertAudioFile(file: Express.Multer.File): void {
    if (!file.buffer?.length) throw new BadRequestException('提示音频为空');
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('提示音频不能超过 10MB');
    const extension = extname(file.originalname).toLowerCase();
    const allowedMime = ALLOWED_MIME_PREFIXES.some((prefix) => file.mimetype.startsWith(prefix));
    if (!ALLOWED_EXTENSIONS.has(extension) && !allowedMime) {
      throw new BadRequestException('仅支持 wav、mp3、m4a、aac 音频文件');
    }
  }

  private async writeStorageFile(relativePath: string, buffer: Buffer): Promise<void> {
    const fullPath = this.resolveStoragePath(relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);
  }

  private resolveStoragePath(relativePath: string): string {
    const fullPath = resolve(this.storageRoot, relativePath);
    if (!fullPath.startsWith(this.storageRoot)) {
      throw new BadRequestException('Invalid storage path');
    }
    return fullPath;
  }

  private toDomain(record: VoiceCloneRecord): VoiceClone {
    return {
      id: record.id,
      voiceId: record.voiceId,
      name: record.name,
      model: record.model,
      description: record.description,
      status: record.status as VoiceClone['status'],
      sourceFilename: record.sourceFilename,
      sourceMimeType: record.sourceMimeType,
      sourceFileSize: record.sourceFileSize,
      sourceAudioUrl: `/api/voice-clones/${encodeURIComponent(record.id)}/audio`,
      previewText: record.previewText ?? undefined,
      previewAudioUrl: record.previewFilePath
        ? `/api/voice-clones/${encodeURIComponent(record.id)}/preview-audio`
        : undefined,
      previewGeneratedAt: record.previewGeneratedAt?.toISOString(),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

function resolveWorkspacePath(...parts: string[]): string {
  const cwd = process.cwd();
  const root = basename(cwd) === 'api' && basename(dirname(cwd)) === 'apps'
    ? resolve(cwd, '..', '..')
    : cwd;
  return resolve(root, ...parts);
}

function normalizeModel(model?: string): string {
  const value = model?.trim().toLowerCase();
  if (!value) return VoiceCloneModel.QWEN;
  if (value === 'qwen' || value === 'qwen-tts') return VoiceCloneModel.QWEN;
  if (value === 'cosyvoice' || value === 'cosyvoice2') return VoiceCloneModel.COSYVOICE;
  return VoiceCloneModel.QWEN;
}

function formatModelName(model: string): string {
  return model === VoiceCloneModel.COSYVOICE ? 'CosyVoice' : 'Qwen TTS';
}

function isLocalDraftVoiceId(voiceId: string): boolean {
  return /^voice_[a-f0-9]{16}$/i.test(voiceId);
}

function buildPreferredVoiceName(record: VoiceCloneRecord): string {
  return `vc${record.id.replace(/-/g, '').slice(0, 14)}`;
}

function buildCosyVoicePrefix(record: VoiceCloneRecord): string {
  // CosyVoice 复刻 prefix 要求：仅小写字母和数字，长度 < 10。
  return `cv${record.id.replace(/-/g, '').slice(0, 7)}`.toLowerCase();
}

function normalizeOriginalFilename(filename: string): string {
  const value = basename(filename);
  if (!value) return '';
  try {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD') && /[\u4e00-\u9fff]/.test(decoded)) {
      return decoded;
    }
  } catch {
    // Keep Multer's value when decoding is not applicable.
  }
  return value;
}

function resolveDashScopeBaseUrl(): string {
  const explicit = (
    process.env.DASHSCOPE_API_BASE_URL ??
    process.env.DASHSCOPE_BASE_URL ??
    ''
  ).trim();
  if (explicit) {
    return explicit.replace(/\/services\/.*$/, '').replace(/\/+$/, '');
  }
  return 'https://dashscope.aliyuncs.com/api/v1';
}

function isRealtimeQwenTargetModel(model: string): boolean {
  return model.includes('realtime');
}

function assertHttpQwenVoiceCloneTargetModel(model: string): void {
  if (isRealtimeQwenTargetModel(model)) {
    throw new Error(`Qwen TTS HTTP 非流式合成接口不支持 realtime 模型 ${model}（realtime 复刻音色只能走 WebSocket 流式合成，试听已改为源音频兜底）`);
  }
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}

function decodeDashScopeAudioData(value: string): { buffer: Buffer; mimeType: string } {
  const buffer = Buffer.from(stripDataUrlPrefix(value), 'base64');
  if (buffer.length === 0) throw new Error('Qwen TTS 返回空音频');
  return {
    buffer,
    mimeType: normalizeGeneratedAudioMimeType(extractDataUrlMimeType(value), undefined, buffer),
  };
}

function extractDataUrlMimeType(value: string): string | undefined {
  const match = /^data:([^;,]+)/i.exec(value);
  return match?.[1];
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  return value.startsWith('data:') && commaIndex >= 0
    ? value.slice(commaIndex + 1)
    : value;
}

function normalizeGeneratedAudioMimeType(contentType: string | null | undefined, url: string | undefined, buffer: Buffer): string {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase();
  if (normalized?.startsWith('audio/') || normalized === 'video/mp4') return normalized;
  if (hasWavHeader(buffer)) return 'audio/wav';
  const path = parseUrlPathname(url);
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.m4a') || path.endsWith('.mp4')) return 'audio/mp4';
  if (path.endsWith('.aac')) return 'audio/aac';
  if (path.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/wav';
}

function parseUrlPathname(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function extensionForPreview(mimeType: string, buffer: Buffer): string {
  const type = mimeType.toLowerCase();
  if (type.includes('mpeg') || type.includes('mp3')) return '.mp3';
  if (type.includes('mp4') || type.includes('m4a')) return '.m4a';
  if (type.includes('aac')) return '.aac';
  if (type.includes('ogg')) return '.ogg';
  if (type.includes('wav') || hasWavHeader(buffer)) return '.wav';
  return '.wav';
}

function normalizeExtension(filename: string, mimeType: string): string {
  const extension = extname(filename).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(extension)) return extension;
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return '.mp3';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return '.m4a';
  if (mimeType.includes('aac')) return '.aac';
  return '.wav';
}

function normalizeMimeType(mimeType: string, extension: string): string {
  if (mimeType.startsWith('audio/') || mimeType === 'video/mp4') return mimeType;
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.m4a') return 'audio/mp4';
  if (extension === '.aac') return 'audio/aac';
  return 'audio/wav';
}

function hasWavHeader(buffer: Buffer): boolean {
  return buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE';
}

function wrapPcm16AsWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
