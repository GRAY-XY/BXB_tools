using Microsoft.UI.Xaml;

namespace BxbHomework.WinUI;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
        UnhandledException += OnUnhandledException;
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            _window = new MainWindow();
            _window.Activate();
        }
        catch (Exception error)
        {
            LogException(error);
            throw;
        }
    }

    private static void OnUnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs args)
    {
        LogException(args.Exception);
    }

    internal static void LogException(Exception error)
    {
        try
        {
            var directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BXBHomework");
            Directory.CreateDirectory(directory);
            File.AppendAllText(
                Path.Combine(directory, "app.log"),
                $"[{DateTimeOffset.Now:O}] {error}\n",
                System.Text.Encoding.UTF8);
        }
        catch
        {
            // Logging must never mask the original crash.
        }
    }
}
