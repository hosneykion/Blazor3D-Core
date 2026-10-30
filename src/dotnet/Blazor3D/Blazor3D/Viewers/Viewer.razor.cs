using Microsoft.JSInterop;
using Microsoft.AspNetCore.Components;
using HomagGroup.Blazor3D.Settings;
using HomagGroup.Blazor3D.Scenes;
using HomagGroup.Blazor3D.Cameras;
using HomagGroup.Blazor3D.Controls;
using Newtonsoft.Json;
using HomagGroup.Blazor3D.Maths;
using HomagGroup.Blazor3D.Objects;
using HomagGroup.Blazor3D.Lights;
using HomagGroup.Blazor3D.ComponentHelpers;
using HomagGroup.Blazor3D.Events;
using Newtonsoft.Json.Linq;
using HomagGroup.Blazor3D.Core;
using HomagGroup.Blazor3D.Materials;

namespace HomagGroup.Blazor3D.Viewers
{
    /// <summary>
    /// <para>HomagGroup.Blazor3D viewer component.</para>
    /// </summary>
    public sealed partial class Viewer : IDisposable, IAsyncDisposable
    {
        private IJSObjectReference? bundleModule;
        private readonly SemaphoreSlim lifecycleGate = new(1, 1);
        private readonly CancellationTokenSource lifetime = new();
        private readonly string viewerInstanceId = Guid.NewGuid().ToString("N");
        private int disposeStarted;
        private bool eventsSubscribed;
        private bool IsDisposing => Volatile.Read(ref disposeStarted) != 0;

        private delegate void SelectedObjectStaticEventHandler(Object3DStaticArgs e);
        private static event SelectedObjectStaticEventHandler ObjectSelectedStatic = null!;

        private delegate void LoadedObjectStaticEventHandler(Object3DStaticArgs e);
        private static event LoadedObjectStaticEventHandler ObjectLoadedStatic = null!;

        private event LoadedObjectEventHandler ObjectLoadedPrivate = null!;

        
        /// <summary>
        /// Raises when user selects object by mouse clicking inside viewer area.
        /// </summary>
        public event SelectedObjectEventHandler ObjectSelected = null!;

        /// <summary>
        /// Raises after complete loading of imported file content.
        /// </summary>
        public event LoadedObjectEventHandler ObjectLoaded = null!;

        
        /// <summary>
        /// Raises after JavaScript module is completely loaded.
        /// </summary>
        public event LoadedModuleEventHandler JsModuleLoaded = null!;
       


        /// <summary>
        /// <para><see cref="Settings.ViewerSettings"/> parameter of the component.</para>
        /// </summary>
        [Parameter]
        public ViewerSettings ViewerSettings { get; set; } = new ViewerSettings();

        /// <summary>
        /// <para><see cref="Scenes.Scene"/> parameter of the component. Default is empty scene.</para>
        /// </summary>
        [Parameter]
        public Scene Scene { get; set; } = new Scene();

        /// <summary>
        /// <para>If true and there is no children objects in the scene, then adds the default lights and box mesh. Default value is false.</para>
        /// </summary>
        [Parameter]
        public bool UseDefaultScene { get; set; } = false;

        /// <summary>
        /// <para><see cref="PerspectiveCamera"/> used to display the scene.</para>
        /// </summary>
        [Parameter]
        public Camera Camera { get; set; } = new PerspectiveCamera() { Position = new Vector3(3, 3, 3) };

        /// <summary>
        /// <para><see cref="Controls.OrbitControls"/> used to rotate, pan and scale the view.</para>
        /// </summary>
        [Parameter]
        public OrbitControls OrbitControls { get; set; } = new OrbitControls();

        protected override async Task OnAfterRenderAsync(bool firstRender)
        {
            if (!firstRender || IsDisposing) return;
            SubscribeEvents();

			IJSObjectReference? importedModule;
			try
            {
                importedModule = await JSRuntime.InvokeAsync<IJSObjectReference>(
                    "import", "./_content/DEM.Blazor3D/js/bundle.js");
            }
            catch (JSDisconnectedException) when (IsDisposing)
            {
                return;
            }

            await lifecycleGate.WaitAsync();
            try
            {
                if (!IsDisposing)
                {
                    bundleModule = importedModule;
                    importedModule = null;

                    if (UseDefaultScene && !Scene.Children.Any()) AddDefaultScene();

                    var json = JsonConvert.SerializeObject(new
                    {
						Scene,
						ViewerSettings,
						Camera,
						OrbitControls,
                    }, SerializationHelper.GetSerializerSettings());

                    await GetBundleModule().InvokeVoidAsync("loadViewer", lifetime.Token, viewerInstanceId, json);
                }
            }
            catch (Exception) when (IsDisposing)
            {
                if (bundleModule is not null)
                {
                    var failedModule = bundleModule;
                    bundleModule = null;
                    await TryDisposeViewerAsync(failedModule, viewerInstanceId);
                    await TryDisposeModuleAsync(failedModule);
                }
                return;
            }
            catch
            {
                if (bundleModule is not null)
                {
                    var failedModule = bundleModule;
                    bundleModule = null;
                    await TryDisposeViewerAsync(failedModule, viewerInstanceId);
                    await TryDisposeModuleAsync(failedModule);
                }
                throw;
            }
            finally
            {
                lifecycleGate.Release();
            }

            if (importedModule is not null) await TryDisposeModuleAsync(importedModule);
            if (!IsDisposing) await OnModuleLoaded();
        }

        private IJSObjectReference GetBundleModule()
        {
            if (IsDisposing || bundleModule is null) throw new ObjectDisposedException(nameof(Viewer));
            return bundleModule;
        }


        private object?[] InstanceArguments(object?[] args)
        {
            var result = new object?[args.Length + 1];
            result[0] = viewerInstanceId;
            Array.Copy(args, 0, result, 1, args.Length);
            return result;
        }

        private async Task InvokeBundleVoidAsync(string identifier, params object?[] args)
        {
            if (IsDisposing) throw new ObjectDisposedException(nameof(Viewer));
            await lifecycleGate.WaitAsync(lifetime.Token);
            try
            {
                await GetBundleModule().InvokeVoidAsync(identifier, lifetime.Token, InstanceArguments(args));
            }
            finally { lifecycleGate.Release(); }
        }

        private async Task<T> InvokeBundleAsync<T>(string identifier, params object?[] args)
        {
            if (IsDisposing) throw new ObjectDisposedException(nameof(Viewer));
            await lifecycleGate.WaitAsync(lifetime.Token);
            try
            {
                return await GetBundleModule().InvokeAsync<T>(identifier, lifetime.Token, InstanceArguments(args));
            }
            finally { lifecycleGate.Release(); }
        }

        private void SubscribeEvents()
        {
            if (eventsSubscribed || IsDisposing) return;
            ObjectSelectedStatic += OnObjectSelectedStatic;
            ObjectLoadedStatic += OnObjectLoadedStatic;
            ObjectLoadedPrivate += OnObjectLoadedPrivate;
            eventsSubscribed = true;
        }

        private void UnsubscribeEvents()
        {
            if (!eventsSubscribed) return;
            ObjectSelectedStatic -= OnObjectSelectedStatic;
            ObjectLoadedStatic -= OnObjectLoadedStatic;
            ObjectLoadedPrivate -= OnObjectLoadedPrivate;
            eventsSubscribed = false;
        }

        /// <summary>
        /// Updates scene changes.
        /// </summary>
        /// <returns>Task</returns>
        public async Task UpdateScene()
        {
            var json = JsonConvert.SerializeObject(Scene, SerializationHelper.GetSerializerSettings());
            await InvokeBundleVoidAsync("updateScene", json);
        }

        /// <summary>Pauses rendering while preserving the viewer and its scene.</summary>
        public Task PauseRendering() => InvokeBundleVoidAsync("pauseViewer");

        /// <summary>Resumes rendering and renders the current scene.</summary>
        public Task ResumeRendering() => InvokeBundleVoidAsync("resumeViewer");

        /// <summary>
        /// <para>Sets the camera position to specified <see cref="Vector3"/> value.</para>
        /// </summary>
        /// <param name="position">New <see cref="Vector3"/> position.</param>
        /// <param name="lookAt">New <see cref="Vector3"/> camera target point coordinates.</param>
        /// <returns>Task</returns>
        public async Task SetCameraPositionAsync(Vector3 position, Vector3 lookAt = null!)
        {
            await InvokeBundleVoidAsync("setCameraPosition", position, lookAt);
        }

        /// <summary>
        /// Apply updated camera settings to viewer.
        /// </summary>
        /// <returns>Task</returns>
        public async Task UpdateCamera(Camera camera)
        {
            Camera = camera;
            var json = JsonConvert.SerializeObject(Camera, SerializationHelper.GetSerializerSettings());
            await InvokeBundleVoidAsync("updateCamera", json);
        }

        /// <summary>
        /// Prints information about current camera and orbit controls into browser console.
        /// </summary>
        /// <returns>Task</returns>
        public async Task ShowCurrentCameraInfo()
        {
            await InvokeBundleVoidAsync("showCurrentCameraInfo");
        }

        /// <summary>
        /// Apply updated orbit controls to viewer.
        /// </summary>
        /// <param name="orbitControls">new orbit controls</param>
        /// <returns>Task</returns>
        public async Task UpdateOrbitControls(OrbitControls orbitControls)
        {
            OrbitControls = orbitControls;
            var json = JsonConvert.SerializeObject(OrbitControls, SerializationHelper.GetSerializerSettings());
            await InvokeBundleVoidAsync("updateOrbitControls", json);
        }

        [JSInvokable]
        public static Task<string> ReceiveSelectedObjectUUID(string containerId, string uuid)
        {
            var guid = string.IsNullOrWhiteSpace(uuid) ? Guid.Empty : Guid.Parse(uuid);
            var result = containerId + uuid;
            ObjectSelectedStatic?.Invoke(new Object3DStaticArgs()
            {
                ContainerId = containerId,
                UUID = guid,
            });
            return Task.FromResult(result);
        }

        [JSInvokable]
        public static Task ReceiveLoadedObjectUUID(string containerId, string uuid)
        {
            var result = containerId + uuid;
            ObjectLoadedStatic?.Invoke(new Object3DStaticArgs()
            {
                ContainerId = containerId,
                UUID = new Guid(uuid),
            });
            return Task.CompletedTask;
        }

        /// <summary>
        /// Removes object from scene by it's unique identifier.
        /// </summary>
        /// <param name="uuid">Object's unique identifier.</param>
        /// <returns>Task</returns>
        public async Task RemoveByUuidAsync(Guid uuid)
        {
            var result = await InvokeBundleAsync<bool>("removeByUuid", uuid);
            if (result)
            {
                ChildrenHelper.RemoveObjectByUuid(uuid, Scene.Children);
            }
        }

        /// <summary>
        /// <para>Selects object in scene by it's unique identifier</para>
        /// </summary>
        /// <param name="uuid">Unique identifier of object to select</param>
        /// <returns>Task</returns>
        public async Task SelectByUuidAsync(Guid uuid)
        {
            await InvokeBundleVoidAsync("selectByUuid", uuid);
        }

        /// <summary>
        /// Clears scene.
        /// </summary>
        /// <returns>Task</returns>
        public async Task ClearSceneAsync()
        {
            await InvokeBundleVoidAsync("clearScene");
            Scene.Children.Clear();
        }

        /// <summary>
        /// <para>Imports 3D model to scene.</para>
        /// </summary>
        /// <param name="settings"><see cref="ImportSettings"/> Settings that will be applied during 3D model file importing.</param>
        /// <returns>Guid of the loaded item</returns>
        public async Task<Guid> Import3DModelAsync(ImportSettings settings)
        {
            settings.Uuid = settings.Uuid ?? Guid.NewGuid();
            settings.Material = settings.Material ?? new MeshStandardMaterial();
            var json = JsonConvert.SerializeObject(settings, SerializationHelper.GetSerializerSettings());
            await InvokeBundleVoidAsync("import3DModel", json);
            return settings.Uuid.Value;
        }

        /// <summary>
        /// <para>Imports sprite to scene.</para>
        /// </summary>
        /// <param name="settings"> Settings that will be applied during 2D sprite file importing.</param>
        /// <returns>Guid of the loaded item</returns>
        public async Task<Guid> ImportSpriteAsync(SpriteImportSettings settings)
        {
            settings.Uuid = settings.Uuid ?? Guid.NewGuid();
            settings.Material = settings.Material ?? new SpriteMaterial();
            var json = JsonConvert.SerializeObject(settings, SerializationHelper.GetSerializerSettings());
            await InvokeBundleVoidAsync("importSprite", json);
            return settings.Uuid.Value;
        }

        /// <summary>
        /// <para>Recursively finds object by it's uuid in collection.</para>
        /// </summary>
        /// <param name="uuid">Object's uuid</param>
        /// <param name="children">Children collection. Usually it's Scene.Children</param>
        /// <returns>Found object or null</returns>
        public static Object3D? GetObjectByUuid(Guid uuid, List<Object3D> children)
        {
            return ChildrenHelper.GetObjectByUuid(uuid, children);
        }

        private async Task OnModuleLoaded()
        {
            if (IsDisposing)
            {
                return;
            }

            LoadedModuleEventHandler handler = JsModuleLoaded;

            if (handler == null)
            {
                return;
            }

            Delegate[] invocationList = handler.GetInvocationList();
            Task[] handlerTasks = new Task[invocationList.Length];

            for (int i = 0; i < invocationList.Length; i++)
            {
                if (IsDisposing)
                {
                    return;
                }
                handlerTasks[i] = ((LoadedModuleEventHandler)invocationList[i])();
            }

            await Task.WhenAll(handlerTasks);
        }

        //todo: move to helper
        private void AddDefaultScene()
        {
            Scene.Add(new AmbientLight());
            Scene.Add(new PointLight()
            {
                Position = new Vector3
                {
                    X = 1,
                    Y = 3,
                    Z = 0
                }
            });
            Scene.Add(new Mesh());
        }

        private void OnObjectSelectedStatic(Object3DStaticArgs e)
        {
            if (!IsDisposing && viewerInstanceId == e.ContainerId)
            {
                ObjectSelected?.Invoke(new Object3DArgs() { UUID = e.UUID });
            }
        }

        private void OnObjectLoadedStatic(Object3DStaticArgs e)
        {
            if (!IsDisposing && viewerInstanceId == e.ContainerId)
            {
                ObjectLoadedPrivate?.Invoke(new Object3DArgs() { UUID = e.UUID });
            }
        }

        //todo: move to children helper
        private List<Object3D> ParseChildren(JToken? children)
        {
            var result = new List<Object3D>();
            if (children?.Type != JTokenType.Array)
            {
                return result;
            }

            foreach (JToken child in children)
            {
                var c = child as JObject;
                if (c == null)
                {
                    continue;
                }

                var type = c.Property("type")?.Value.ToString();
                var name = c.Property("name")?.Value.ToString() ?? string.Empty;
                var uuid = c.Property("uuid")?.Value.ToString() ?? string.Empty;
                if (type == "Mesh")
                {
                    var mesh = new Mesh()
                    {
                        Name = name,
                        Uuid = Guid.Parse(uuid)
                    };
                    result.Add(mesh);
                }

                if (type == "Group")
                {
                    var ch = c.Property("children")?.Value;
                    var childrenResult = ParseChildren(ch);
                    var group = new Group
                    {
                        Name = name,
                        Uuid = Guid.Parse(uuid),
                    };
                    group.Children.AddRange(childrenResult);
                }
            }
            return result;
        }

        private async Task OnObjectLoadedPrivate(Object3DArgs e)
        {
            if (IsDisposing || bundleModule is null)
            {
                return;
            }

            string json;
            try
            {
                json = await InvokeBundleAsync<string>("getSceneItemByGuid", e.UUID);
            }
            catch (Exception) when (IsDisposing)
            {
                return;
            }

            if (IsDisposing || string.IsNullOrEmpty(json))
            {
                return;
            }

            if (json.Contains("\"type\":\"Group\""))
            {
                var jobject = JObject.Parse(json);
                var name = jobject.Property("name")?.Value.ToString() ?? string.Empty;
                var uuidstr = jobject.Property("uuid")?.Value.ToString() ?? string.Empty;
                var children = jobject.Property("children")?.Value;
                var childrenResult = ParseChildren(children);
                var group = new Group
                {
                    Name = name,
                    Uuid = Guid.Parse(uuidstr),
                };
                group.Children.AddRange(childrenResult);

                if (IsDisposing) return;
                Scene.Children.Add(group);
                ObjectLoaded?.Invoke(new Object3DArgs() { UUID = e.UUID });
            }

            if (json.Contains("\"type\":\"Mesh\""))
            {
                var mesh = JsonConvert.DeserializeObject<Mesh>(json);
                if (mesh != null && !IsDisposing)
                {
                    Scene.Children.Add(mesh);
                    ObjectLoaded?.Invoke(new Object3DArgs() { UUID = e.UUID });
                }
            }

            if (json.Contains("\"type\":\"Sprite\""))
            {
                var sprite = JsonConvert.DeserializeObject<Sprite>(json);
                if (sprite != null && !IsDisposing)
                {
                    Scene.Children.Add(sprite);
                    ObjectLoaded?.Invoke(new Object3DArgs() { UUID= e.UUID });
                }
            }
        }

        private static async Task TryDisposeViewerAsync(IJSObjectReference module, string? containerId)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await module.InvokeVoidAsync("disposeViewer", timeout.Token, containerId);
            }
            catch (Exception ex) when (ex is JSDisconnectedException || ex is JSException || ex is ObjectDisposedException || ex is InvalidOperationException || ex is OperationCanceledException)
            {
            }
        }

        private static async Task TryDisposeModuleAsync(IJSObjectReference module)
        {
            try
            {
                await module.DisposeAsync();
            }
            catch (Exception ex) when (ex is JSDisconnectedException || ex is JSException || ex is ObjectDisposedException || ex is InvalidOperationException || ex is OperationCanceledException)
            {
            }
        }

        public void Dispose()
        {
            _ = DisposeAndLogFailuresAsync();
        }

        private async Task DisposeAndLogFailuresAsync()
        {
            try
            {
                await DisposeAsync();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Trace.TraceError("Blazor3D viewer disposal failed: {0}", ex);
            }
        }

        public async ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref disposeStarted, 1) != 0) return;
            lifetime.Cancel();
            UnsubscribeEvents();
            JsModuleLoaded = null!;
            ObjectLoaded = null!;
            ObjectSelected = null!;

            await lifecycleGate.WaitAsync();
            try
            {
                var module = bundleModule;
                bundleModule = null;
                if (module is not null)
                {
                    await TryDisposeViewerAsync(module, viewerInstanceId);
                    await TryDisposeModuleAsync(module);
                }
            }
            finally
            {
                lifecycleGate.Release();
                lifetime.Dispose();
            }
        }
    }
}
