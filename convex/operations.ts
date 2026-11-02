import { ConvexError } from 'convex/values'
export function isReady() {
  return process.env.MOMOI_MAINTENANCE !== 'restore'
}
export function requireReady() {
  if (!isReady()) throw new ConvexError('MAINTENANCE')
}
