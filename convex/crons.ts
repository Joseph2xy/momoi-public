import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
crons.interval('provider maintenance and expiry', { minutes: 1 }, internal.provider.sweep, {})
export default crons
