"use client";

import { IssueBadge } from "./issue-badge";
import { StatusBadge, SeverityBadge } from "./status-badge";
import { ScanResults } from "./scan-results";
import { formatDate } from "@/lib/utils";
import type { Incident, ScanSummary } from "@/lib/types";
import { useState } from "react";

export function IncidentDetail({ incident }: { incident: Incident }) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "scan" | "report" | "prompt"
  >("overview");

  const tabs = [
    { key: "overview" as const, label: "Overview" },
    { key: "scan" as const, label: "Scan Results" },
    { key: "report" as const, label: "Remediation Report" },
    { key: "prompt" as const, label: "Patch Prompt" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface-1 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold text-zinc-100 mb-1">
              {incident.emailSubject || incident.issueType}
            </h1>
            <div className="text-xs text-zinc-500">
              {incident.property} &middot;{" "}
              {formatDate(incident.detectedAt)} &middot; ID: {incident.id}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <StatusBadge status={incident.status} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IssueBadge code={incident.normalizedCode} />
          <span className="text-xs text-zinc-500">
            {incident.issueFamily} &middot; {incident.affectedUrls.length} affected URL(s)
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800 pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
              activeTab === tab.key
                ? "border-accent text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {activeTab === "overview" && (
          <OverviewTab incident={incident} />
        )}
        {activeTab === "scan" && (
          <ScanTab scanSummary={incident.scanSummary} />
        )}
        {activeTab === "report" && (
          <ReportTab report={incident.remediationReport} />
        )}
        {activeTab === "prompt" && (
          <PromptTab prompt={incident.generatedPatchPrompt} />
        )}
      </div>
    </div>
  );
}

function OverviewTab({ incident }: { incident: Incident }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Incident Fields */}
      <div className="bg-surface-1 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-200">Incident Details</h2>
        <div className="space-y-3">
          <Field label="Issue Family" value={incident.issueFamily} />
          <Field label="Issue Type" value={incident.issueType} />
          <Field label="Normalized Code" value={incident.normalizedCode} mono />
          <Field label="Property" value={incident.property} />
          <Field label="Source" value={incident.source} />
          <Field
            label="Detected"
            value={formatDate(incident.detectedAt)}
          />
        </div>
      </div>

      {/* Affected URLs */}
      <div className="bg-surface-1 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-4">
          Affected URLs ({incident.affectedUrls.length})
        </h2>
        {incident.affectedUrls.length === 0 ? (
          <div className="text-xs text-zinc-500">No URLs recorded.</div>
        ) : (
          <div className="space-y-2">
            {incident.affectedUrls.map((url, i) => (
              <div
                key={i}
                className="text-xs text-zinc-400 font-mono bg-surface-2 px-3 py-2 rounded-lg truncate"
              >
                {url}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Diagnosis */}
      {incident.diagnosis && (
        <div className="lg:col-span-2 bg-surface-1 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-200 mb-3">Diagnosis</h2>
          <pre className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed">
            {incident.diagnosis}
          </pre>
        </div>
      )}
    </div>
  );
}

function ScanTab({
  scanSummary,
}: {
  scanSummary: ScanSummary | null;
}) {
  if (!scanSummary) {
    return (
      <div className="bg-surface-1 border border-zinc-800 border-dashed rounded-xl p-12 text-center">
        <div className="text-zinc-500 text-sm">No scan results available.</div>
        <div className="text-zinc-600 text-xs mt-1">
          Run a scan via the API to populate results.
        </div>
      </div>
    );
  }

  return <ScanResults summary={scanSummary} />;
}

function ReportTab({ report }: { report: string | null }) {
  if (!report) {
    return (
      <div className="bg-surface-1 border border-zinc-800 border-dashed rounded-xl p-12 text-center">
        <div className="text-zinc-500 text-sm">
          No remediation report generated yet.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-1 border border-zinc-800 rounded-xl p-6">
      <pre className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
        {report}
      </pre>
    </div>
  );
}

function PromptTab({ prompt }: { prompt: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!prompt) {
    return (
      <div className="bg-surface-1 border border-zinc-800 border-dashed rounded-xl p-12 text-center">
        <div className="text-zinc-500 text-sm">
          No patch prompt generated yet.
        </div>
      </div>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">
          Claude Code Patch Prompt
        </h2>
        <button
          onClick={handleCopy}
          className="text-xs px-3 py-1.5 bg-accent/10 text-accent border border-accent/30 rounded-md hover:bg-accent/20 transition-colors"
        >
          {copied ? "Copied" : "Copy Prompt"}
        </button>
      </div>
      <pre className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed bg-surface-1 border border-zinc-800 rounded-xl p-6 max-h-[600px] overflow-y-auto">
        {prompt}
      </pre>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-zinc-500">{label}</span>
      <span
        className={`text-xs text-zinc-300 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
