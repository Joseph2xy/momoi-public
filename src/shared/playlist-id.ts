export function playlistIdFromInput(value: string): string | null {
  const input = value.trim()
  if (input.length > 2048) return null
  if (/^[A-Za-z0-9_-]{10,100}$/.test(input)) return input
  try {
    const url = new URL(input)
    const id = url.searchParams.get('list') ?? ''
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)
      && ['/playlist', '/watch'].includes(url.pathname) && /^[A-Za-z0-9_-]{10,100}$/.test(id) ? id : null
  } catch { return null }
}
