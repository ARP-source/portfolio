/**
 * GLSL for the Field. Units are CSS pixels in viewport space; y grows downward like the DOM.
 * texPos: xy position, w seed.  texVel: xy velocity, z activation (0 rest .. 1 signal).
 */

// 3D simplex noise, Ashima Arts / Stefan Gustavson, MIT licence (github.com/ashima/webgl-noise).
const simplex3 = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
// Divergence-free 2D flow: curl of a scalar noise potential, by central differences.
vec2 curl2(vec3 p){
  const float e=0.08;
  float n1=snoise(p+vec3(0.0,e,0.0)); float n2=snoise(p-vec3(0.0,e,0.0));
  float n3=snoise(p+vec3(e,0.0,0.0)); float n4=snoise(p-vec3(e,0.0,0.0));
  return vec2(n1-n2,-(n3-n4))/(2.0*e);
}
`;

/** Shared uniforms and the trace lookup, prepended to both compute passes. */
const common = /* glsl */ `
uniform float uTime;
uniform float uDt;
uniform float uForm;        // 0 swarm .. 1 trace, already spring-eased on the CPU
uniform vec2 uViewport;     // CSS px
uniform vec4 uTraceRect;    // x, y, w, h of the hero SVG in CSS px
uniform float uPhase;       // playback position along the recording, in trace lengths (period 2: ping-pong)
uniform vec3 uPointer;      // x, y, strength
uniform float uScrollDy;    // px scrolled since last step
uniform float uScroll;      // total scrollY, for the swarm's parallax homes
uniform sampler2D uHome;    // xy swarm home (0..1), z size rank, w trace u
uniform sampler2D uTrace;   // N x 1, r = sample in [-1, 1]
uniform float uTraceN;

float traceAt(float u){
  float x=u*(uTraceN-1.0); float i=floor(x);
  float a=texelFetch(uTrace,ivec2(int(i),0),0).r;
  float b=texelFetch(uTrace,ivec2(int(min(i+1.0,uTraceN-1.0)),0),0).r;
  return mix(a,b,x-i);
}
// Swarm homes scroll with the page at 30 % (parallax) and wrap in a band slightly taller than the viewport.
const float WRAP_M=40.0;
vec2 swarmHome(vec4 h){
  float span=uViewport.y+2.0*WRAP_M;
  float y=mod(h.y*span-uScroll*0.3,span)-WRAP_M;
  return vec2(h.x*uViewport.x,y);
}
vec2 traceTarget(vec4 h, float seed, out float s){
  float u=h.w;
  // Ping-pong through the recording (forward, then back) so playback loops without a seam.
  s=traceAt(1.0-abs(1.0-2.0*fract((u+uPhase)*0.5)));
  float y=uTraceRect.y+uTraceRect.w*0.5-s*uTraceRect.w*0.44;
  // A line a few px thick, not a single row of points.
  y+=(seed-0.5)*2.4;
  return vec2(uTraceRect.x+u*uTraceRect.z,y);
}
`;

export const velocityShader = /* glsl */ `
${simplex3}
${common}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 P=texture2D(texPos,uv); vec4 V=texture2D(texVel,uv); vec4 H=texture2D(uHome,uv);
  vec2 pos=P.xy; vec2 vel=V.xy; float seed=P.w;

  // Swarm: each particle has a home that wanders slowly on a noise field; the particle is
  // steered toward it with a little curl flow on top. Steering, not forcing, keeps it calm,
  // and a capped speed means leaving the trace is a quick spread, not a jump.
  vec2 home=swarmHome(H);
  float tt=uTime*0.04;
  home+=vec2(snoise(vec3(H.xy*3.0,tt)),snoise(vec3(H.xy*3.0+17.0,tt)))*70.0;
  vec2 flow=curl2(vec3(pos/260.0,tt+seed*0.15));
  vec2 desired=(home-pos)*1.1+flow*6.0;
  float sp=length(desired); if(sp>700.0) desired*=700.0/sp;
  vec2 aSwarm=(desired-vel)*3.0;

  // Trace: critically damped spring to a point on the recorded EMG line.
  float s; vec2 target=traceTarget(H,seed,s);
  const float k=60.0;
  vec2 aTrace=k*(target-pos)-2.0*sqrt(k)*vel;

  vec2 acc=mix(aSwarm,aTrace,uForm);

  // The visitor's pointer pushes particles aside, within 140 px.
  vec2 d=pos-uPointer.xy; float r=length(d);
  float push=uPointer.z*pow(max(0.0,1.0-r/140.0),2.0);
  if(r>0.001) acc+=d/r*push*1800.0;

  vel+=acc*uDt;
  // Activation: bronze where the recording spikes or the pointer touched, olive at rest.
  float act=max(uForm*smoothstep(0.15,0.8,abs(s)), push);
  float z=mix(V.z,act,1.0-exp(-uDt*6.0));
  gl_FragColor=vec4(vel,z,1.0);
}
`;

export const positionShader = /* glsl */ `
${common}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 P=texture2D(texPos,uv); vec4 V=texture2D(texVel,uv); vec4 H=texture2D(uHome,uv);
  vec2 pos=P.xy+V.xy*uDt;
  // Swarm particles move rigidly with their parallax homes, so scrolling never stretches them.
  pos.y-=uScrollDy*0.3*(1.0-uForm);
  if(uForm<0.5){
    float span=uViewport.y+2.0*WRAP_M;
    float hy=swarmHome(H).y;
    if(pos.y-hy>0.5*span) pos.y-=span;
    else if(hy-pos.y>0.5*span) pos.y+=span;
  }
  // Once the trace formation has settled, lock particles to the line: no spring lag while it plays.
  float lock=smoothstep(0.85,1.0,uForm);
  if(lock>0.0){
    float s; vec2 target=traceTarget(H,P.w,s);
    pos=mix(pos,target,lock);
  }
  gl_FragColor=vec4(pos,P.z,P.w);
}
`;

export const pointsVertex = /* glsl */ `
uniform sampler2D texPos;
uniform sampler2D texVel;
uniform sampler2D uHome;
uniform vec2 uViewport;
uniform float uPixelRatio;
attribute vec2 ref;
varying float vAct;
varying vec2 vScreen;
varying float vRank;
void main(){
  vec4 P=texture2D(texPos,ref); vec4 V=texture2D(texVel,ref); vec4 H=texture2D(uHome,ref);
  vec2 ndc=vec2(P.x/uViewport.x*2.0-1.0, 1.0-P.y/uViewport.y*2.0);
  gl_Position=vec4(ndc,0.0,1.0);
  vAct=V.z; vRank=H.z; vScreen=P.xy/uViewport;
  gl_PointSize=mix(1.4,2.8,H.z*H.z)*uPixelRatio;
}
`;

export const pointsFragment = /* glsl */ `
uniform vec3 uOlive;
uniform vec3 uBronze;
uniform vec3 uBone;
uniform sampler2D uMask;   // 1 where text sits, blurred
uniform float uFade;       // global fade-in, 0..1
uniform float uMaskStrength;
varying float vAct;
varying vec2 vScreen;
varying float vRank;
void main(){
  vec2 c=gl_PointCoord-0.5; float r2=dot(c,c);
  if(r2>0.25) discard;
  vec3 col=mix(uOlive,uBronze,clamp(vAct,0.0,1.0));
  // A small bright core reads as metal, no bloom pass needed.
  col=mix(col,uBone,smoothstep(0.09,0.0,r2)*0.25*(0.4+vAct));
  float edge=smoothstep(0.25,0.12,r2);
  float mask=texture2D(uMask,vec2(vScreen.x,1.0-vScreen.y)).r;
  float a=edge*mix(0.5,0.9,vRank)*(1.0-uMaskStrength*mask)*uFade;
  gl_FragColor=vec4(col,a);
}
`;
