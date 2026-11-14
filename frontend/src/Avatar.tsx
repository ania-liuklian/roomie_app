/** The existing Roomie character, drawn only with SVG (no external images). */
export const AVATAR_COLORS = ["#BF8790", "#C48F78", "#8D9C83", "#C5A078", "#A68D84", "#DB8999", "#9A786F", "#9D76CF"] as const;
export type AvatarOptions = {
  color?: string;
  eye_style?: "plain" | "lashes";
  gaze?: "straight" | "left" | "right" | "up" | "happy" | "sleepy";
};

function Eyes({ options, color }: { options: AvatarOptions; color: string }) {
  const gaze = options.gaze || "straight";
  const cx = gaze === "left" ? 35 : gaze === "right" ? 78 : 64.5;
  const cy = gaze === "up" ? 25 : 48.5;
  return <>
    {gaze === "happy" ? <path d="M20 60 Q50 25 80 60" fill="none" stroke="#15110f" strokeWidth="8" strokeLinecap="round" /> : <>
      <circle cx="50" cy="50" r="50" fill="#ffffff" />
      <circle cx={cx} cy={cy} r="19.5" fill="#15110f" />
      {gaze === "sleepy" && <><path d="M0 50 A50 50 0 0 1 100 50 Z" fill={color} /><path d="M2 50 H98" stroke="#15110f" strokeWidth="3" /></>}
    </>}
    {options.eye_style === "lashes" && <path d={gaze === "happy" ? "M26 47 L17 35 M43 37 L40 22 M64 39 L70 25" : "M18 13 L8 0 M38 2 L33 -13 M62 2 L68 -13"}
      stroke="#15110f" strokeWidth="5" strokeLinecap="round" fill="none" />}
  </>;
}

export default function Avatar({ member, size = "md", variant = "avatar" }: {
  member: AvatarOptions & { name: string };
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  variant?: "avatar" | "profile" | "peek";
}) {
  const candidate = member.color?.toUpperCase();
  const color = AVATAR_COLORS.find((value) => value === candidate) || AVATAR_COLORS[0];
  if (variant !== "avatar") return <div className={variant === "profile" ? "profile-roomie-head" : "roomie-peek"}
    role="img" aria-label={`Аватар: ${member.name}`} style={{ background: "transparent", overflow: "hidden" }}>
    <svg aria-hidden="true" width="100%" height="100%" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, borderRadius: "inherit" }}>
      <rect width="100%" height="100%" fill={color} />
    </svg>
    {[0, 1].map((eye) => <svg key={eye} aria-hidden="true" width="45" height="45" viewBox="0 0 100 100"
      style={{ position: "relative", width: 45, height: 45, marginLeft: -3, overflow: "visible" }}>
      <Eyes options={member} color={color} />
    </svg>)}
  </div>;
  return <span className={`avatar avatar-${size} face-avatar`} role="img" aria-label={`Аватар: ${member.name}`} style={{ background: color }}>
    <svg aria-hidden="true" viewBox="0 0 100 100" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
      <rect width="100" height="100" fill={color} />
      {[17.81, 51.11].map((x) => <svg key={x} x={x} y="20" width="31.08" height="31.08" viewBox="0 0 100 100" overflow="visible">
        <Eyes options={member} color={color} />
      </svg>)}
    </svg>
  </span>;
}
