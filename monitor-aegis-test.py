#!/usr/bin/env python3
"""
Monitor Aegis feedback loop test (Task #286)
Shows task progression and feedback injection
"""
import sqlite3
import time
import sys

DB = ".data/mission-control.db"
TASK_ID = 286

def monitor():
    while True:
        conn = sqlite3.connect(DB)
        c = conn.cursor()
        
        # Get task
        c.execute("SELECT status, retry_count, resolution FROM tasks WHERE id=?", (TASK_ID,))
        task = c.fetchone()
        
        if not task:
            print(f"❌ Task {TASK_ID} not found")
            conn.close()
            break
        
        status, retry_count, resolution = task
        
        # Get comments
        c.execute("SELECT COUNT(*) FROM comments WHERE task_id=?", (TASK_ID,))
        comment_count = c.fetchone()[0]
        
        # Get Aegis feedback
        c.execute("""
            SELECT content FROM comments 
            WHERE task_id=? AND author='aegis' AND content LIKE 'Quality Review Rejected:%'
            ORDER BY created_at DESC LIMIT 1
        """, (TASK_ID,))
        aegis_feedback = c.fetchone()
        
        conn.close()
        
        # Display
        print(f"\n{'='*70}")
        print(f"Task #{TASK_ID} — Status: {status} | Retry: {retry_count} | Comments: {comment_count}")
        print(f"{'='*70}")
        
        # Status progression
        if status == "assigned":
            print("⏳ STAGE 1: Waiting for dispatch...")
        elif status == "in_progress":
            print("▶️  STAGE 2: Agent working...")
        elif status == "review":
            print("👁️  STAGE 3: Awaiting Aegis review...")
        elif status == "quality_review":
            print("🔍 STAGE 4: Aegis evaluating...")
        elif status == "done":
            print("✅ COMPLETE: Task approved!")
        elif status == "awaiting_owner":
            print("⚠️  ESCALATED: Owner review needed (2+ rejections)")
        
        # Show feedback if rejected
        if aegis_feedback:
            content = aegis_feedback[0]
            lines = content.split('\n')[1:3]
            print(f"\n📋 Aegis Feedback:")
            for line in lines[:2]:
                if line:
                    print(f"   {line[:65]}")
        
        # Check if resolution has feedback markers
        if resolution and "⚠️" in resolution:
            print(f"\n✅ FEEDBACK INJECTED: Agent received ⚠️ section in prompt")
        
        print(f"\nPress Ctrl+C to stop | Next check in 5s...")
        
        try:
            time.sleep(5)
        except KeyboardInterrupt:
            print("\n\nMonitoring stopped.")
            break

if __name__ == "__main__":
    print(f"🚀 Monitoring Aegis Feedback Loop Test (Task #{TASK_ID})")
    monitor()
