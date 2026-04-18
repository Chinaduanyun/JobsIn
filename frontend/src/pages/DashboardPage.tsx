import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Briefcase, ListTodo, FileText, Send } from 'lucide-react'
import { jobs, tasks, resumes, applications } from '@/lib/api'

export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalJobs: 0,
    activeTasks: 0,
    hasResume: false,
    appliedToday: 0,
  })

  useEffect(() => {
    const fetchStats = () => {
      Promise.all([
        jobs.list({ page: 1, page_size: 1 }),
        tasks.list(),
        resumes.list(),
        applications.today(),
      ]).then(([jobRes, taskList, resumeList, todayRes]) => {
        setStats({
          totalJobs: jobRes.total,
          activeTasks: taskList.filter((t) => t.status === 'running').length,
          hasResume: resumeList.some((r) => r.is_active),
          appliedToday: todayRes.count,
        })
      }).catch(() => {})
    }
    fetchStats()
    const timer = setInterval(fetchStats, 5000)
    return () => clearInterval(timer)
  }, [])

  const cards = [
    {
      title: '已采集岗位',
      value: stats.totalJobs,
      icon: Briefcase,
      color: 'text-blue-500',
    },
    {
      title: '进行中任务',
      value: stats.activeTasks,
      icon: ListTodo,
      color: 'text-orange-500',
    },
    {
      title: '简历状态',
      value: stats.hasResume ? '已设置' : '未设置',
      icon: FileText,
      color: stats.hasResume ? 'text-green-500' : 'text-red-500',
    },
    {
      title: '今日已投递',
      value: stats.appliedToday,
      icon: Send,
      color: 'text-purple-500',
    },
  ]

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">仪表盘</h2>
      <div className="grid grid-cols-4 gap-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
