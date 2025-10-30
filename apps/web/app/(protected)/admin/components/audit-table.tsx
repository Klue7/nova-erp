"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AuditRow = {
  occurred_at: string;
  aggregate_type: string;
  event_type: string;
  actor_role: string;
  payload: Record<string, unknown>;
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [aggregateFilter, setAggregateFilter] = useState<string>("all");
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const aggregates = useMemo(
    () => Array.from(new Set(rows.map((row) => row.aggregate_type))).sort(),
    [rows],
  );
  const eventTypes = useMemo(
    () => Array.from(new Set(rows.map((row) => row.event_type))).sort(),
    [rows],
  );
  const roles = useMemo(
    () => Array.from(new Set(rows.map((row) => row.actor_role))).sort(),
    [rows],
  );

  const filtered = rows.filter((row) => {
    if (aggregateFilter !== "all" && row.aggregate_type !== aggregateFilter) {
      return false;
    }
    if (eventFilter !== "all" && row.event_type !== eventFilter) {
      return false;
    }
    if (roleFilter !== "all" && row.actor_role !== roleFilter) {
      return false;
    }
    if (search.trim().length > 0) {
      const text = JSON.stringify(row.payload).toLowerCase();
      if (!text.includes(search.trim().toLowerCase())) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-4">
        <select
          value={aggregateFilter}
          onChange={(event) => setAggregateFilter(event.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="all">All aggregates</option>
          {aggregates.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={eventFilter}
          onChange={(event) => setEventFilter(event.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="all">All events</option>
          {eventTypes.map((event) => (
            <option key={event} value={event}>
              {event}
            </option>
          ))}
        </select>
        <select
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="all">All actors</option>
          {roles.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <Input
          placeholder="Search payload (JSON)"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="overflow-x-auto rounded-md border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Aggregate</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Actor role</TableHead>
              <TableHead>Payload</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => (
              <TableRow key={`${row.occurred_at}-${row.event_type}`}>
                <TableCell>{formatTimestamp(row.occurred_at)}</TableCell>
                <TableCell className="capitalize">
                  {row.aggregate_type}
                </TableCell>
                <TableCell>{row.event_type}</TableCell>
                <TableCell>{row.actor_role}</TableCell>
                <TableCell>
                  <pre className="max-h-32 overflow-auto rounded bg-muted px-2 py-1 text-xs">
                    {JSON.stringify(row.payload, null, 2)}
                  </pre>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No events match the selected filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
