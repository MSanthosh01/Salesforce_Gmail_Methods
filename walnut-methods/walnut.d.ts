// Walnut context type definitions

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: any;
  responseTime: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string>;
  timeout?: number;
  auth?: {
    type: 'bearer' | 'basic' | 'apiKey';
    token?: string;
    username?: string;
    password?: string;
    key?: string;
    value?: string;
    in?: 'header' | 'query';
  };
}

export interface AndroidSelector {
  resourceId?: string;
  text?: string;
  contentDesc?: string;
  hint?: string;
  testTag?: string;
  xpath?: string;
}

export interface WalnutBaseContext {
  platform: string;
  testBaseUrl: string;
  args: string[];
  variableContext: Record<string, any>;
  params: Record<string, any>;

  replacePlaceholders(text: string): string;
  log(message: string): void;
  warn(message: string): void;
  setVariable(name: string, value: any): void;
  getVariable(name: string): any;
  /**
   * Resolves a Walnut artifact name or ID to a local file path on disk.
   * If the value is already a local file path, it is returned as-is.
   */
  resolveArtifact(artifactNameOrPath: string): Promise<string>;
}

export interface WalnutWebContext extends WalnutBaseContext {
  platform: 'web';
  page: import('playwright').Page;
  locator?: string;

  // Element
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  hover(selector: string): Promise<void>;
  dblclick(selector: string): Promise<void>;
  focus(selector: string): Promise<void>;
  blur(selector: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  drag(sourceSelector: string, targetSelector: string): Promise<void>;
  fileUpload(selector: string, filePath: string): Promise<void>;
  tap(selector: string): Promise<void>;
  check(selector: string): Promise<void>;
  uncheck(selector: string): Promise<void>;
  clear(selector: string): Promise<void>;

  // Navigation
  navigate(url: string): Promise<void>;
  navigateBack(): Promise<void>;
  reload(): Promise<void>;
  goForward(): Promise<void>;
  close(): Promise<void>;

  // Verification
  verifyElementVisible(selector: string): Promise<void>;
  verifyElementHidden(selector: string): Promise<void>;
  verifyTextVisible(text: string): Promise<void>;
  verifyValue(selector: string, expectedValue: string): Promise<void>;
  verifyUrlContains(substring: string): Promise<void>;
  verifyNavigation(urlPattern: string): Promise<void>;

  // Wait
  waitForVisible(selector: string, opts?: any): Promise<void>;
  waitForHidden(selector: string, opts?: any): Promise<void>;
  wait(ms: number): Promise<void>;
  waitForNavigation(opts?: any): Promise<void>;
  waitForUrl(urlPattern: string, opts?: any): Promise<void>;
  waitForAttached(selector: string, opts?: any): Promise<void>;
  waitForDetached(selector: string, opts?: any): Promise<void>;

  // Query
  getText(selector: string): Promise<string>;
  getAttribute(selector: string, attribute: string): Promise<string>;
  getInputValue(selector: string): Promise<string>;
  getUrl(): Promise<string>;
  getTitle(): Promise<string>;
  count(selector: string): Promise<number>;
  isVisible(selector: string): Promise<boolean>;
  isEnabled(selector: string): Promise<boolean>;
  isChecked(selector: string): Promise<boolean>;

  // Mouse
  mouseClick(x: number, y: number): Promise<void>;
  mouseMove(x: number, y: number): Promise<void>;
  mouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<void>;

  // Layout
  setViewportSize(width: number, height: number): Promise<void>;

  // Tab
  switchToTab(index: number): Promise<void>;
  getTabCount(): Promise<number>;

  // Advanced
  evaluate(script: string): Promise<any>;
  screenshot(opts?: any): Promise<void>;
  scroll(opts?: any): Promise<void>;
  handleDialog(action: 'accept' | 'dismiss', promptText?: string): Promise<void>;
}

export interface WalnutApiContext extends WalnutBaseContext {
  platform: 'api';

  request(method: string, url: string, body?: any, opts?: RequestOptions): Promise<ApiResponse>;
  get(url: string, opts?: RequestOptions): Promise<ApiResponse>;
  post(url: string, body?: any, opts?: RequestOptions): Promise<ApiResponse>;
  put(url: string, body?: any, opts?: RequestOptions): Promise<ApiResponse>;
  patch(url: string, body?: any, opts?: RequestOptions): Promise<ApiResponse>;
  delete(url: string, opts?: RequestOptions): Promise<ApiResponse>;

  setHeader(name: string, value: string): void;
  setAuth(type: string, credentials: any): void;
  getCookies(url: string): Promise<any[]>;
  setCookie(cookie: any, url: string): Promise<void>;

  extractFromBody(response: ApiResponse, jsonPath: string): any;

  assertStatus(response: ApiResponse, expected: number): void;
  assertBodyContains(response: ApiResponse, text: string): void;
  assertResponseTime(response: ApiResponse, maxMs: number): void;
  assertHeader(response: ApiResponse, headerName: string, expected: string): void;
  assertBodyEquals(response: ApiResponse, jsonPath: string, expected: any): void;
  assertBodyMatches(response: ApiResponse, jsonPath: string, regex: string): void;
}

export interface WalnutIosContext extends WalnutBaseContext {
  platform: 'ios';
  locator?: string;

  getText(xpath: string): Promise<string>;
  getAttribute(xpath: string, attribute: string): Promise<string>;
  tap(xpath: string): Promise<void>;
  tapAt(x: number, y: number): Promise<void>;
  doubleTap(xpath: string): Promise<void>;
  longPressAt(x: number, y: number, duration: number): Promise<void>;
  type(xpath: string, text: string): Promise<void>;
  clear(xpath: string): Promise<void>;
  submit(xpath: string): Promise<void>;
  hideKeyboard(): Promise<void>;
  pressButton(name: string): Promise<void>;
  back(): Promise<void>;
  home(): Promise<void>;
  verifyVisible(xpath: string): Promise<void>;
  verifyNotVisible(xpath: string): Promise<void>;
  verifyText(xpath: string, text: string): Promise<void>;
  verifyPartialText(xpath: string, text: string): Promise<void>;
  verifyEnabled(xpath: string): Promise<void>;
  verifyDisabled(xpath: string): Promise<void>;
  verifySelected(xpath: string): Promise<void>;
  isVisible(xpath: string): Promise<boolean>;
  waitFor(xpath: string, timeoutMs: number): Promise<void>;
  scrollToText(text: string, direction: string): Promise<void>;
  scrollToElement(xpath: string, direction: string): Promise<void>;
  swipe(direction: string): Promise<void>;
  launchApp(bundleId: string): Promise<void>;
  terminateApp(bundleId: string): Promise<void>;
  activateApp(bundleId: string): Promise<void>;
  callTool(name: string, args: any): Promise<any>;
}

export interface WalnutAndroidContext extends WalnutBaseContext {
  platform: 'android';
  objectDescription?: string;

  getText(): Promise<string>;
  getAttribute(attribute: string): Promise<string>;
  click(): Promise<void>;
  tap(): Promise<void>;
  type(text: string): Promise<void>;
  clear(): Promise<void>;
  longPress(): Promise<void>;
  isVisible(): Promise<boolean>;

  getTextBy(selector: AndroidSelector): Promise<string>;
  getAttributeBy(selector: AndroidSelector, attribute: string): Promise<string>;
  clickBy(selector: AndroidSelector): Promise<void>;
  tapBy(selector: AndroidSelector): Promise<void>;
  typeBy(selector: AndroidSelector, text: string): Promise<void>;
  clearBy(selector: AndroidSelector): Promise<void>;
  isVisibleBy(selector: AndroidSelector): Promise<boolean>;

  back(): Promise<void>;
  home(): Promise<void>;
  pressKey(keyName: string): Promise<void>;
  hideKeyboard(): Promise<void>;
  openNotifications(): Promise<void>;
  swipe(direction: string): Promise<void>;
  scrollToText(text: string): Promise<void>;
  clickByText(text: string): Promise<void>;
  startApp(packageName: string): Promise<void>;
  closeApp(packageName: string): Promise<void>;
  resetApp(packageName: string): Promise<void>;
  callTool(name: string, args: any): Promise<any>;
}

export type WalnutContext =
  | WalnutWebContext
  | WalnutApiContext
  | WalnutIosContext
  | WalnutAndroidContext;
