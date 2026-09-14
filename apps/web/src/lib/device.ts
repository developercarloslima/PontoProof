function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getDeviceFingerprint() {
  let id = localStorage.getItem('pontoproof_device_id');
  if (!id) {
    id = uuid();
    localStorage.setItem('pontoproof_device_id', id);
  }
  return `web:${id}:${navigator.platform || 'unknown'}`;
}

export async function getLocation(): Promise<{latitude?:number;longitude?:number;accuracyM?:number;altitudeM?:number;altitudeAccuracyM?:number;headingDeg?:number;speedMps?:number;locationCapturedAt?:string}> {
  if (!navigator.geolocation) return {};
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({ latitude:p.coords.latitude, longitude:p.coords.longitude, accuracyM:p.coords.accuracy, altitudeM:p.coords.altitude??undefined, altitudeAccuracyM:p.coords.altitudeAccuracy??undefined, headingDeg:p.coords.heading??undefined, speedMps:p.coords.speed??undefined, locationCapturedAt:new Date(p.timestamp).toISOString() }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 15000 }
    );
  });
}
