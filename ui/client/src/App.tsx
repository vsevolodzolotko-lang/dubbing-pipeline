import { Navigate, Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { StageRail } from './components/StageRail'
import { RunBanner } from './components/RunBanner'
import { RegenBanner } from './components/RegenBanner'
import { CartBar } from './components/CartBar'
import { Dashboard } from './screens/Dashboard'
import { TranscriptReview } from './screens/TranscriptReview'
import { TranslationReview } from './screens/TranslationReview'
import { Workbench } from './screens/Workbench'
import { Qa } from './screens/Qa'
import { Voices } from './screens/Voices'
import { Config } from './screens/Config'
import { Placeholder } from './screens/Placeholder'
import { SetupErrorScreen } from './screens/SetupError'

export default function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <StageRail />
        <RunBanner />
        <RegenBanner />
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/lesson" replace />} />
            <Route path="/lesson" element={<Dashboard />} />
            <Route path="/transcript" element={<TranscriptReview />} />
            <Route path="/translation" element={<TranslationReview />} />
            <Route path="/review" element={<Workbench />} />
            <Route path="/qa" element={<Qa />} />
            <Route path="/voices" element={<Voices />} />
            <Route path="/prompts" element={<Placeholder title="Промпти" phase="v3" />} />
            <Route path="/cps" element={<Placeholder title="Калібрування CPS" phase="v3" />} />
            <Route path="/config" element={<Config />} />
            <Route path="/archive" element={<Placeholder title="Архів" phase="v3" />} />
            <Route path="/setup" element={<SetupErrorScreen />} />
            <Route path="*" element={<Navigate to="/lesson" replace />} />
          </Routes>
        </main>
        <CartBar />
      </div>
    </div>
  )
}
