export const currency = (value: number | null) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(value ?? 0)

export const quantity = (value: number | null, unit?: string | null) => {
  const amount = new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 2,
  }).format(value ?? 0)

  return unit ? `${amount} ${unit}` : amount
}

export const relativeLabel = (value: string | null) => {
  if (!value) return 'Sem prazo'

  const input = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value)
  if (Number.isNaN(input.getTime())) return value

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(input)
}
