import { ImageResponse } from "next/og";

// The CareNest mark (a roof over a heart) as PNG app icons, drawn from the same shapes as <LogoMark>.
export function generateImageMetadata() {
  return [192, 512].map((size) => ({ id: String(size), size: { width: size, height: size }, contentType: "image/png" }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = Number(await id);
  return new ImageResponse(<Mark size={size} />, { width: size, height: size });
}

export function Mark({ size }: { size: number }) {
  // Full-bleed square (no rounded corners): launchers apply their own mask, and "maskable" needs the edges filled.
  return (
    <div style={{ width: size, height: size, display: "flex", background: "#0e6457" }}>
      <svg width={size} height={size} viewBox="-4 -4 48 48">
        <path d="M8.5 16.5 20 7l11.5 9.5" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d="M20 32.5s-7.5-4.6-7.5-9.8c0-2.4 1.7-4.2 3.9-4.2 1.5 0 2.8.9 3.6 2.1.8-1.2 2.1-2.1 3.6-2.1 2.2 0 3.9 1.8 3.9 4.2 0 5.2-7.5 9.8-7.5 9.8Z"
          fill="#ffffff"
        />
      </svg>
    </div>
  );
}
