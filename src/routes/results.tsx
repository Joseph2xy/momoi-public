import { createFileRoute } from '@tanstack/react-router'
import { ResultsPage } from '../components/results-page'
export const Route = createFileRoute('/results')({ component: ResultsPage })
