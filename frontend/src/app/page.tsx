import { Card } from '@/components/ui/card';

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
      <div className="max-w-3xl w-full space-y-8">
        <div className="space-y-4">
          <h1 className="text-4xl md:text-6xl font-bold text-foreground">
            Project Shutdown
          </h1>
          <p className="text-xl text-muted-foreground">
            Slayshot is no longer active. Thank you for your interest and support.
          </p>
        </div>

        {/* Demo Video */}
        <Card className="w-full aspect-video bg-muted overflow-hidden">
          <video
            className="w-full h-full object-contain"
            controls
            playsInline
          >
            <source src="/sample.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </Card>

        <div className="text-sm text-muted-foreground">
          <p>
            The above video is a showcase of the project. Will add more videos here soon.
          </p>
        </div>
      </div>
    </div>
  );
}
