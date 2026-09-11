import { useState, useEffect } from 'react';
import { getApiUrl, getApiHeaders } from '../lib/api';

export type StreamQuality = 
  | 'source' 
  | '1080p_high' 
  | '1080p_std' 
  | '720p_high' 
  | '720p_std' 
  | '480p_high' 
  | '480p_std' 
  | '360p_low';

let globalSpeedTestRun = false;
let globalSpeedMbps: number | null = null;
let globalPreferredQuality: StreamQuality | null = null;
let listeners: Array<() => void> = [];

export function useSpeedTest() {
  const [preferredQuality, setPreferredQuality] = useState<StreamQuality>(() => {
    return globalPreferredQuality || (sessionStorage.getItem('preferredQuality') as StreamQuality) || 'source';
  });
  const [speedMbps, setSpeedMbps] = useState<number | null>(globalSpeedMbps);
  const [isTesting, setIsTesting] = useState(!globalSpeedTestRun || (globalSpeedTestRun && globalSpeedMbps === null));

  useEffect(() => {
    const handler = () => {
      if (globalPreferredQuality) setPreferredQuality(globalPreferredQuality);
      if (globalSpeedMbps !== null) setSpeedMbps(globalSpeedMbps);
      setIsTesting(false);
    };
    listeners.push(handler);
    return () => {
      listeners = listeners.filter(l => l !== handler);
    };
  }, []);

  useEffect(() => {
    if (globalSpeedTestRun) return;
    globalSpeedTestRun = true;
    setIsTesting(true);
    
    const testSpeed = async () => {
      try {
        const startTime = performance.now();
        const response = await fetch(getApiUrl('/api/speedtest'), { cache: 'no-store', headers: getApiHeaders() });
        
        if (!response.ok) throw new Error('Speedtest failed');
        
        const blob = await response.blob();
        const endTime = performance.now();
        
        const durationSeconds = (endTime - startTime) / 1000;
        const bitsLoaded = blob.size * 8;
        const speedBps = bitsLoaded / durationSeconds;
        const mbps = speedBps / (1024 * 1024);
        
        globalSpeedMbps = mbps;
        
        // Re-enabled auto-quality selection primarily for remote HDHomeRun streaming
        if (!sessionStorage.getItem('userQualitySet')) {
            if (mbps > 8) {
              globalPreferredQuality = '1080p_high';
            } else if (mbps > 5) {
              globalPreferredQuality = '720p_high';
            } else if (mbps > 2.5) {
              globalPreferredQuality = '480p_high';
            } else {
              globalPreferredQuality = '360p_low';
            }
            sessionStorage.setItem('preferredQuality', globalPreferredQuality);
        } else {
            globalPreferredQuality = (sessionStorage.getItem('preferredQuality') as StreamQuality) || 'source';
        }

      } catch (err) {
        console.error('Speedtest error:', err);
      } finally {
        listeners.forEach(l => l());
      }
    };
    testSpeed();
  }, []);

  const manuallySetQuality = (quality: StreamQuality) => {
    globalPreferredQuality = quality;
    sessionStorage.setItem('preferredQuality', quality);
    sessionStorage.setItem('userQualitySet', 'true');
    listeners.forEach(l => l());
  };

  return { preferredQuality, manuallySetQuality, speedMbps, isTesting };
}

