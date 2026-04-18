import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Briefcase,
  ListTodo,
  FileText,
  Send,
  Star,
} from 'lucide-react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '仪表盘' },
  { to: '/resumes', icon: FileText, label: '我的简历' },
  { to: '/tasks', icon: ListTodo, label: '采集任务' },
  { to: '/jobs', icon: Briefcase, label: '岗位列表' },
  { to: '/recommendations', icon: Star, label: 'AI 推荐' },
  { to: '/applications', icon: Send, label: '投递管理' },
]

export default function AppLayout() {
  const [version, setVersion] = useState('0.0')

  useEffect(() => {
    fetch('/api/version').then(r => r.json()).then(d => setVersion(d.version)).catch(() => {})
  }, [])

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r bg-muted/30 flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-lg font-bold">🔍 JobsIn</h1>
          <p className="text-xs text-muted-foreground">多平台智能投递</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t text-xs text-muted-foreground">
          JobsIn v{version}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
