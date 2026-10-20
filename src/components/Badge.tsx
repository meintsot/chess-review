import { badgeSvg, classText } from '../lib/classes'
import type { Classification } from '../lib/review'
import { useLang } from '../i18n'

export function Badge({ cls, size = 18 }: { cls: Classification; size?: number }) {
  const lang = useLang()
  return (
    <svg className="badge" width={size} height={size} viewBox="0 0 100 100" aria-label={classText(cls, lang).label} role="img"
      dangerouslySetInnerHTML={{ __html: badgeSvg(cls) }} />
  )
}
