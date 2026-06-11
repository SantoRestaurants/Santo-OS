"use client";

import { Sidebar } from "./Sidebar";
import { TutorialProvider } from "@/components/tutorial/TutorialProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TutorialProvider>
      <div className="flex min-h-screen bg-[#f7f7f5]">
        <Sidebar />
        <div className="flex-1 lg:ml-0">{children}</div>
      </div>
    </TutorialProvider>
  );
}
