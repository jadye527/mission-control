'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('QualityReviewPanel')

interface Review {
  id: number
  task_id: number
  reviewer: string
  status: 'approved' | 'rejected'
  notes: string | null
  created_at: number
  evidence: {
    tests_command: string | null
    tests_result: string | null
    output_paths: string[]
    resolution_memo: string | null
  } | null
}

interface Task {
  id: number
  title: string
  status: string
  assigned_to?: string
  tests_command?: string
  tests_result?: string
  output_paths?: string[]
  resolution_memo?: string
  ticket_ref?: string
}

export default function QualityReviewPanel() {
  const [queueTasks, setQueueTasks] = useState<Task[]>([])
  const [recentReviews, setRecentReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskReviews, setTaskReviews] = useState<Review[]>([])

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?status=quality_review&limit=50')
      if (!res.ok) throw new Error('Failed to fetch QC queue')
      const data = await res.json()
      setQueueTasks(data.tasks || [])
    } catch (err) {
      log.error('Failed to fetch QC queue', err)
    }
  }, [])

  const fetchRecentReviews = useCallback(async () => {
    try {
      // Get recently reviewed tasks (done status, ordered by updated)
      const res = await fetch('/api/tasks?status=done&limit=10&sort=updated_at&order=desc')
      if (!res.ok) return
      const data = await res.json()
      const doneTasks = data.tasks || []
      if (doneTasks.length === 0) return

      const ids = doneTasks.map((t: Task) => t.id).join(',')
      const reviewRes = await fetch(`/api/quality-review?taskIds=${ids}`)
      if (!reviewRes.ok) return
      const reviewData = await reviewRes.json()

      // Build a flat list of recent reviews with task info
      const reviews: Review[] = []
      for (const task of doneTasks) {
        const latest = reviewData.latest?.[task.id]
        if (latest?.status) {
          reviews.push({
            id: task.id,
            task_id: task.id,
            reviewer: latest.reviewer || 'unknown',
            status: latest.status,
            notes: null,
            created_at: latest.created_at || 0,
            evidence: null,
          })
        }
      }
      setRecentReviews(reviews)
    } catch (err) {
      log.error('Failed to fetch recent reviews', err)
    }
  }, [])

  const fetchTaskReviews = useCallback(async (taskId: number) => {
    try {
      const res = await fetch(`/api/quality-review?taskId=${taskId}`)
      if (!res.ok) throw new Error('Failed to fetch reviews')
      const data = await res.json()
      setTaskReviews(data.reviews || [])
    } catch (err) {
      log.error('Failed to fetch task reviews', err)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchQueue(), fetchRecentReviews()]).finally(() => setLoading(false))
    const interval = setInterval(() => {
      fetchQueue()
      fetchRecentReviews()
    }, 60000)
    return () => clearInterval(interval)
  }, [fetchQueue, fetchRecentReviews])

  useEffect(() => {
    if (selectedTask) {
      fetchTaskReviews(selectedTask.id)
    }
  }, [selectedTask, fetchTaskReviews])

  const selectTask = (task: Task) => {
    setSelectedTask(task)
    setTaskReviews([])
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Quality Reviews</h2>
        <button
          onClick={() => { fetchQueue(); fetchRecentReviews() }}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* QC Queue */}
          <div className="lg:col-span-1 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Awaiting Review ({queueTasks.length})
            </h3>
            {queueTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tasks awaiting quality review.</p>
            ) : (
              <div className="space-y-2">
                {queueTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => selectTask(task)}
                    className={`w-full text-left p-3 rounded border transition-colors ${
                      selectedTask?.id === task.id
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-border bg-card hover:bg-surface-1/40'
                    }`}
                  >
                    <div className="text-sm font-medium text-foreground truncate">{task.title}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex gap-2">
                      {task.ticket_ref && <span>{task.ticket_ref}</span>}
                      {task.assigned_to && <span>by {task.assigned_to}</span>}
                    </div>
                    {(task.tests_command || task.resolution_memo) && (
                      <div className="mt-1.5 flex gap-1">
                        {task.tests_command && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">tests</span>
                        )}
                        {task.resolution_memo && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">memo</span>
                        )}
                        {task.output_paths && task.output_paths.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">outputs</span>
                        )}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Recent reviews */}
            {recentReviews.length > 0 && (
              <>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mt-6">
                  Recent Decisions
                </h3>
                <div className="space-y-1.5">
                  {recentReviews.map((r) => (
                    <div key={r.id} className="text-xs text-foreground/70 flex items-center gap-2">
                      <span className={r.status === 'approved' ? 'text-green-400' : 'text-red-400'}>
                        {r.status === 'approved' ? '\u2713' : '\u2717'}
                      </span>
                      <span className="truncate">Task #{r.task_id}</span>
                      <span className="text-muted-foreground">{r.reviewer}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selectedTask ? (
              <div className="border border-border rounded-lg bg-card p-4 space-y-4">
                <div>
                  <h3 className="text-base font-medium text-foreground">{selectedTask.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedTask.ticket_ref && `${selectedTask.ticket_ref} \u00b7 `}
                    {selectedTask.assigned_to && `Assigned to ${selectedTask.assigned_to} \u00b7 `}
                    Status: {selectedTask.status}
                  </p>
                </div>

                {/* Evidence section */}
                {(selectedTask.resolution_memo || selectedTask.tests_command || selectedTask.tests_result || (selectedTask.output_paths && selectedTask.output_paths.length > 0)) && (
                  <div className="border border-border rounded p-3 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Evidence</p>

                    {selectedTask.resolution_memo && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Resolution Memo</p>
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap">{selectedTask.resolution_memo}</p>
                      </div>
                    )}

                    {selectedTask.tests_command && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Test Command</p>
                        <pre className="text-xs text-foreground/80 bg-surface-1/60 rounded px-2 py-1.5 font-mono overflow-x-auto">{selectedTask.tests_command}</pre>
                      </div>
                    )}

                    {selectedTask.tests_result && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Test Result</p>
                        <pre className="text-xs text-foreground/80 bg-surface-1/60 rounded px-2 py-1.5 font-mono overflow-x-auto max-h-48 overflow-y-auto">{selectedTask.tests_result}</pre>
                      </div>
                    )}

                    {selectedTask.output_paths && selectedTask.output_paths.length > 0 && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Output Paths</p>
                        <ul className="text-xs text-foreground/80 font-mono space-y-0.5">
                          {selectedTask.output_paths.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Review history */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Review History</p>
                  {taskReviews.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No reviews yet for this task.</p>
                  ) : (
                    <div className="space-y-2">
                      {taskReviews.map((review) => (
                        <div key={review.id} className="text-xs bg-surface-1/40 rounded p-2.5">
                          <div className="flex justify-between items-center">
                            <span className="font-medium">
                              <span className={review.status === 'approved' ? 'text-green-400' : 'text-red-400'}>
                                {review.status}
                              </span>
                              {' \u2014 '}{review.reviewer}
                            </span>
                            <span className="text-muted-foreground">
                              {new Date(review.created_at * 1000).toLocaleString()}
                            </span>
                          </div>
                          {review.notes && (
                            <p className="mt-1 text-foreground/80">{review.notes}</p>
                          )}
                          {review.evidence && (
                            <details className="mt-1.5">
                              <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                                Evidence snapshot
                              </summary>
                              <div className="mt-1 pl-2 border-l border-border space-y-1">
                                {review.evidence.resolution_memo && (
                                  <p className="text-[10px] text-foreground/70">{review.evidence.resolution_memo}</p>
                                )}
                                {review.evidence.tests_command && (
                                  <pre className="text-[10px] text-foreground/60 font-mono">{review.evidence.tests_command}</pre>
                                )}
                                {review.evidence.tests_result && (
                                  <pre className="text-[10px] text-foreground/60 font-mono max-h-24 overflow-y-auto">{review.evidence.tests_result}</pre>
                                )}
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="border border-border border-dashed rounded-lg p-8 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Select a task to view evidence and review history</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
