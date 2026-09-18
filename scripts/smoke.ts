import { getSnapshot, runAutopilotCycle } from "../lib/engine";

async function main() {
  const s = await getSnapshot();
  console.log(
    JSON.stringify(
      {
        equity: s.equityPence,
        cash: s.cashPence,
        marks: s.marks,
        source: s.marketSource,
        error: s.error,
        activity: s.activity[0],
      },
      null,
      2,
    ),
  );
  const r = await runAutopilotCycle();
  console.log("--- cycle ---");
  console.log(
    JSON.stringify(
      {
        equity: r.snapshot.equityPence,
        cash: r.snapshot.cashPence,
        open: r.snapshot.positions,
        halted: r.snapshot.halted,
        trace: r.trace,
        last: r.snapshot.activity.slice(0, 8).map((a) => a.agent + " " + a.message),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
