import type { CSSProperties } from 'react'
import { getCardPngUrl, getPreferredCardImageUrl, handleCardImageError } from '../utils/cardAssets'

interface CardImageProps {
  id: number
  locale?: 'en' | 'pt'
  width?: number
  onClick?: () => void
  disabled?: boolean
  className?: string
  style?: CSSProperties
}

function getCardDisplayName(id: number, locale: 'en' | 'pt'): string {
  if (id >= 1 && id <= 20) return locale === 'pt' ? 'Evento do Passado' : 'Past Event'
  if (id >= 21 && id <= 40) return locale === 'pt' ? 'Evento do Presente' : 'Present Event'
  if (id >= 41 && id <= 60) return locale === 'pt' ? 'Evento do Futuro' : 'Future Event'
  if (id >= 61 && id <= 74) return locale === 'pt' ? 'Evento Paradoxo' : 'Paradox Event'
  if (id >= 75 && id <= 84) return locale === 'pt' ? 'Volta no Tempo' : 'Back in Time'
  if (id >= 85 && id <= 92) return locale === 'pt' ? 'Isso Nunca Aconteceu' : 'That Never Happened'
  if (id >= 93 && id <= 98) return locale === 'pt' ? 'Reescrever Evento' : 'Rewrite Event'
  if (id >= 99 && id <= 106) return locale === 'pt' ? 'Reset Local' : 'Local Reset'
  if (id >= 107 && id <= 112) return locale === 'pt' ? 'Pular Tempo' : 'Time Skip'
  if (id >= 113 && id <= 120) return locale === 'pt' ? 'Troca Temporal' : 'Time Swap'
  return locale === 'pt' ? 'Carta' : 'Card'
}

function getCardShortHint(id: number, locale: 'en' | 'pt'): string {
  if (id >= 1 && id <= 20) return locale === 'pt' ? 'Coloque na timeline; compre 1.' : 'Place in timeline; draw 1.'
  if (id >= 21 && id <= 40)
    return locale === 'pt' ? 'Coloque na timeline; descarte 1 e depois compre 1.' : 'Place in timeline; discard 1 then draw 1.'
  if (id >= 41 && id <= 60) return locale === 'pt' ? 'Revele a mão de um oponente.' : 'Reveal one opponent hand.'
  if (id >= 61 && id <= 74)
    return locale === 'pt' ? 'Troca com uma carta aleatória da mão de um oponente.' : 'Swap with random opponent hand card.'
  if (id >= 75 && id <= 84)
    return locale === 'pt' ? 'Devolve o último evento da timeline para a mão do dono.' : 'Return last timeline event to owner hand.'
  if (id >= 85 && id <= 92) return locale === 'pt' ? 'Carta/efeito de cancelamento de reação.' : 'Reaction cancel card/effect.'
  if (id >= 93 && id <= 98)
    return locale === 'pt' ? 'Substitui um evento da sua timeline.' : 'Replace one event in your timeline.'
  if (id >= 99 && id <= 106) return locale === 'pt' ? 'Descarta um evento de timeline.' : 'Discard one timeline event.'
  if (id >= 107 && id <= 112) return locale === 'pt' ? 'Próximo jogador perde o turno.' : 'Next player skips turn.'
  if (id >= 113 && id <= 120)
    return locale === 'pt' ? 'Troca evento da timeline com oponente.' : 'Swap timeline event with opponent.'
  return locale === 'pt' ? 'Sem dica disponível.' : 'No hint available.'
}

function CardImage({ id, locale = 'en', width = 120, onClick, disabled = false, className, style }: CardImageProps) {
  const tooltip = `${getCardDisplayName(id, locale)} (#${id})\n${getCardShortHint(id, locale)}`
  return (
    <button
      type="button"
      className={className ? `card-image-button ${className}` : 'card-image-button'}
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      style={style}
    >
      <img
        src={getPreferredCardImageUrl(id)}
        data-fallback-src={getCardPngUrl(id)}
        alt={`${locale === 'pt' ? 'Carta' : 'Card'} ${id}`}
        width={width}
        loading="eager"
        decoding="async"
        onError={handleCardImageError}
      />
    </button>
  )
}

export default CardImage
