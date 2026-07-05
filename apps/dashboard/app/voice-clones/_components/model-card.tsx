import type { VoiceCloneModelOption } from './types';

export function ModelCard({
  model,
  selected,
  onSelect,
}: {
  model: VoiceCloneModelOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`voice-clone-model-card ${selected ? 'selected' : ''}`}
    >
      {model.badge && (
        <span className={`voice-clone-model-badge ${model.badge === '推荐' ? 'primary' : 'success'}`}>
          {model.badge}
        </span>
      )}
      <span className="voice-clone-model-heading">
        <span className="voice-clone-radio">
          {selected && <span />}
        </span>
        <strong>{model.name}</strong>
      </span>
      <span className="voice-clone-model-desc">{model.description}</span>
      <span className="voice-clone-model-tags">
        {model.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </span>
    </button>
  );
}
