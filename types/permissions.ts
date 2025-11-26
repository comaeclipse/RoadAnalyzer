export type PermissionState = 'pending' | 'granted' | 'denied' | 'unsupported';

export interface SensorPermissions {
  motion: PermissionState;
  location: PermissionState;
}
