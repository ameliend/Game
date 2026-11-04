import { HAIRS, SKINS } from '../config/game';
import type { Avatar } from '../types';
export const DEFAULT_AVATAR: Avatar = {
  skin: '#dba77c',
  hair: '#754d32',
  shirt: '#eaa66d',
  pants: '#486f70',
};
export function AvatarPortrait({ avatar: a, size = 48 }: { avatar: Avatar; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" role="img" aria-label="Votre avatar">
      <rect width="80" height="80" rx="28" fill="#dce7c7" />
      <path d="M14 80V63Q14 46 40 46Q66 46 66 63V80" fill={a.shirt} />
      <circle cx="40" cy="32" r="19" fill={a.skin} />
      <path d="M21 34V22Q20 7 40 9Q63 7 60 33L54 25Q43 29 29 22L27 36Z" fill={a.hair} />
      <circle cx="34" cy="33" r="1.8" fill="#36433a" />
      <circle cx="47" cy="33" r="1.8" fill="#36433a" />
      <path
        d="M36 41Q41 45 45 40"
        fill="none"
        stroke="#7f4d3b"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function AvatarEditor({
  value,
  onChange,
}: {
  value: Avatar;
  onChange: (a: Avatar) => void;
}) {
  return (
    <div className="avatar-editor">
      <AvatarPortrait avatar={value} size={100} />
      <div className="avatar-options">
        {(
          [
            ['skin', 'Peau', SKINS],
            ['hair', 'Cheveux', HAIRS],
          ] as const
        ).map(([key, label, colors]) => (
          <fieldset key={key}>
            <legend>{label}</legend>
            <div className="swatches">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`${label} ${c}`}
                  aria-pressed={value[key] === c}
                  style={{ background: c }}
                  onClick={() => onChange({ ...value, [key]: c })}
                />
              ))}
            </div>
          </fieldset>
        ))}
        <div className="color-inputs">
          <label>
            Tee-shirt
            <input
              type="color"
              value={value.shirt}
              onChange={(e) => onChange({ ...value, shirt: e.target.value })}
            />
          </label>
          <label>
            Pantalon
            <input
              type="color"
              value={value.pants}
              onChange={(e) => onChange({ ...value, pants: e.target.value })}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
