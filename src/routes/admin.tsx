import { createFileRoute } from '@tanstack/react-router'
import { AdminPage } from '../components/admin-page'

export const Route = createFileRoute('/admin')({ component: AdminPage })
