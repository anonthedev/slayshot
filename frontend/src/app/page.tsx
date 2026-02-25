import { Card, CardContent } from '@/components/ui/card';

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

        {/* Video Placeholder */}
        <Card className="w-full aspect-video bg-muted flex items-center justify-center overflow-hidden">
          <CardContent className="flex flex-col items-center justify-center p-6 text-muted-foreground">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="64" 
              height="64" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="mb-4 opacity-50"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <polyline points="11 3 11 11 14 8 17 11 17 3" />
            </svg>
            <p className="text-lg font-medium">Demo Video Placeholder</p>
            <p className="text-sm">A video demonstrating how the project worked will be added here.</p>
          </CardContent>
        </Card>

        <div className="text-sm text-muted-foreground">
          <p>
            Check back later for the archive video.
          </p>
        </div>
      </div>
    </div>
  );
}
