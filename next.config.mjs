/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disabled because Strict Mode double-mounts components in dev, which makes
  // the camera (getUserMedia) and Bluetooth acquire twice and race — causing
  // the camera to flicker on then die. Production never double-mounts.
  reactStrictMode: false,
};

export default nextConfig;
