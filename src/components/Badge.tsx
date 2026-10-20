import { CLASS_INFO, badgeSvg } from '../lib/classes'
import type { Classification } from '../lib/review'

export function Badge({ cls, size = 18 }: { cls: Classification; size?: number }) {
  return (
    <svg className="badge" width={size} height={size} viewBox="0 0 100 100" aria-label={CLASS_INFO[cls].label} role="img"
      dangerouslySetInnerHTML={{ __html: badgeSvg(cls) }} />
  )
}
