"use client";
import { useSound } from "@/hooks/useSound";

export default function SoundToggle() {
  const { enabled, toggle } = useSound();
  return (
    // Without aria-label the accessible name came from the emoji text node, so
    // this announced as "speaker high volume, button" with no hint that it is a
    // sound toggle and no pressed state. `p-2` gives it a ~40px hit area — it had
    // none at all, so the tap target was the 20x22px glyph, wedged between the
    // logo and the connect button in the mobile header.
    <button
      onClick={toggle}
      aria-label={enabled ? "Mute sound effects" : "Enable sound effects"}
      aria-pressed={enabled}
      className="p-2 -m-1 text-lg opacity-60 hover:opacity-100 transition-opacity"
      title={enabled ? "Mute sounds" : "Enable sounds"}
    >
      <span aria-hidden="true">{enabled ? "\ud83d\udd0a" : "\ud83d\udd07"}</span>
    </button>
  );
}
