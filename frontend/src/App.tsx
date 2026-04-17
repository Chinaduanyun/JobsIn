import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import DashboardPage from '@/pages/DashboardPage'
import JobsPage from '@/pages/JobsPage'
import RecommendationsPage from '@/pages/RecommendationsPage'
import ApplicationsPage from '@/pages/ApplicationsPage'
import TasksPage from '@/pages/TasksPage'
import ResumesPage from '@/pages/ResumesPage'
import SettingsPage from '@/pages/SettingsPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/resumes" element={<ResumesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
