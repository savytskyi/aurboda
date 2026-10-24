import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'

/** A workout type's emoji or image icon, falling back to a dot in the type colour. */
export function WorkoutGlyph({ icon, color }: { icon?: string; color: string }) {
  return icon && isEmoji(icon) ? (
    <span class="workout-badge-emoji">{icon}</span>
  ) : icon && (isUrl(icon) || isIconPath(icon)) ? (
    <img src={icon} alt="" />
  ) : (
    <span class="workout-badge-dot" style={{ background: color }} />
  )
}

/**
 * A workout type's icon on a chip tinted with the type colour. `outline`
 * (dashed, untinted) marks a strength session whose sets were not logged.
 */
export function WorkoutBadge({
  icon,
  color,
  outline = false,
  size = 'md',
  title,
}: {
  icon?: string
  color: string
  outline?: boolean
  size?: 'sm' | 'md'
  title?: string
}) {
  return (
    <span
      class={`workout-badge workout-badge-${size}${outline ? ' outline' : ''}`}
      style={outline ? { borderColor: color } : { background: `${color}33`, borderColor: color }}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      <WorkoutGlyph icon={icon} color={color} />
    </span>
  )
}
