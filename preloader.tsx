function BackgroundCameraPreloader({ camera }: { camera: CameraInfo }) {
  useEffect(() => {
    const subId = \preloader-\\;
    acquireCameraStream(
      camera as any,
      subId,
      () => {}, 
      () => {}
    );
    return () => releaseCameraStream(camera.id, subId);
  }, [camera]);
  return null;
}
