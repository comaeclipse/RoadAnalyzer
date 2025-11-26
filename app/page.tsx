import { PermissionGate } from "@/components/sensors/PermissionGate";
import { SensorDashboard } from "@/components/sensors/SensorDashboard";

export default function Home() {
  return (
    <PermissionGate>
      <SensorDashboard />
    </PermissionGate>
  );
}
