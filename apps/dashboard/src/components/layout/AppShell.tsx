"use client";

import { Sidebar } from "./Sidebar";
import { TutorialProvider } from "@/components/tutorial/TutorialProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TutorialProvider>
      <div className="flex min-h-screen" style={{ background: "#fbfaf7", color: "#282521" }}>
        <Sidebar />
        <div className="flex-1 lg:ml-0 overflow-x-hidden">{children}</div>
      </div>
    </TutorialProvider>
  );
}
