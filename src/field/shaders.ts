import { BONES, HAND_CAM } from './hand';

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

/**
 * Hand and per-particle formation weight; shared by the compute passes and the point shader.
 * The rightmost 40 % of the swarm (by home x) forms the hand when the hero has room for it,
 * so particles only travel a short way. Leaving the hero, each particle lets go at its own
 * moment: the hand first, then the trace from right to left, so the school peels off in order.
 */
const handChunk = /* glsl */ `
uniform float uHandOn;
uniform vec4 uHandRect;     // x, y, w, h in CSS px
uniform mat4 uBones[${BONES}]; // skinning matrices: pose and turn
uniform sampler2D uHandLocal; // xyz point on the hand, w packed skin (bone * 256 + parent weight * 255)
const float HAND_SPLIT=0.6;
const float HAND_CAM=${HAND_CAM.toFixed(1)};
bool isHand(vec4 h){ return uHandOn>0.5 && h.w>HAND_SPLIT; }
float traceU(vec4 h){ return uHandOn>0.5 ? h.w/HAND_SPLIT : h.w; }
float formWeight(vec4 h, float seed, float form){
  float st=isHand(h) ? 0.78+0.2*fract(seed*7.31) : traceU(h)*0.72+0.06*fract(seed*3.7);
  float f=clamp((form-st*0.7)/0.3,0.0,1.0);
  return f*f*(3.0-2.0*f);
}
vec2 handTarget(vec2 uv, out float depth){
  vec4 L=texture2D(uHandLocal,uv);
  int b=int(floor(L.w/256.0+0.001));
  float bl=mod(L.w,256.0)/255.0;
  int pb=(b==0 || (b-1)-3*((b-1)/3)==0) ? 0 : b-1;
  vec4 p=vec4(L.xyz,1.0);
  vec3 w=mix((uBones[b]*p).xyz,(uBones[pb]*p).xyz,bl);
  float scale=min(uHandRect.w/2.2,uHandRect.z/1.9);
  float persp=HAND_CAM/(HAND_CAM-w.z);
  depth=w.z;
  return vec2(uHandRect.x+uHandRect.z*0.5+w.x*scale*persp, uHandRect.y+uHandRect.w*0.5-w.y*scale*persp);
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
uniform float uSnap;        // 1 for a single step: place every particle at its swarm home, at rest
uniform sampler2D uHome;    // xy swarm home (0..1), z size rank, w trace u
uniform sampler2D uTrace;   // N x 1, r = sample in [-1, 1]
uniform float uTraceN;
${handChunk}

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
  float u=traceU(h);
  // Ping-pong through the recording (forward, then back) so playback loops without a seam.
  s=traceAt(1.0-abs(1.0-2.0*fract((u+uPhase)*0.5)));
  float y=uTraceRect.y+uTraceRect.w*0.5-s*uTraceRect.w*0.44;
  // A line a few px thick, not a single row of points.
  y+=(fract(seed*7.13)-0.5)*2.4;
  return vec2(uTraceRect.x+u*uTraceRect.z,y);
}
// Where a particle goes in the hero: its point on the hand, or on the trace.
vec2 heroTarget(vec4 h, float seed, vec2 uv, out float s, out float depth){
  depth=0.0;
  if(isHand(h)){ s=0.45; return handTarget(uv,depth); }
  return traceTarget(h,seed,s);
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
  // Schooling, like krill: a large, slowly turning current that neighbours share, so a released
  // group travels together and fans out, instead of every dot racing straight to its own home.
  vec2 school=curl2(vec3(pos/650.0,uTime*0.05+3.0));
  float sl=length(school); school=sl>0.001 ? school/sl : vec2(0.0);
  // Spooked: for a moment after a particle lets go of a shape it darts toward its spot in the
  // swarm, fast and a little scattered, like krill when a predator shows, then settles back to
  // the slow drift. V.w counts this down from -1 (see 'arrived' below).
  float burst=max(-V.w,0.0);
  vec2 dart=(home-pos)+vec2(snoise(vec3(seed*91.0,uTime*0.7,1.0)),snoise(vec3(seed*37.0,uTime*0.7,5.0)))*90.0*burst;
  vec2 desired=mix((home-pos)*0.8+school*70.0+flow*4.0, dart*3.0, burst);
  float cap=320.0+760.0*burst;
  float sp=length(desired); if(sp>cap) desired*=cap/sp;
  vec2 aSwarm=(desired-vel)*(2.0+5.0*burst);

  // Hero: swim to a point on the hand or the recorded EMG line at a capped speed, the same
  // unhurried pace as the break-up, then settle on it with a stiff spring once close.
  float s, depth; vec2 target=heroTarget(H,seed,uv,s,depth);
  vec2 to=target-pos; float dist=length(to);
  vec2 seek=to*2.2+school*40.0*smoothstep(40.0,200.0,dist);
  float ss=length(seek); if(ss>560.0) seek*=560.0/ss;
  const float k=60.0;
  vec2 aSpring=k*to-2.0*sqrt(k)*vel;
  vec2 aTrace=mix(aSpring,(seek-vel)*3.0,smoothstep(8.0,40.0,dist));

  float fw=formWeight(H,seed,uForm);
  vec2 acc=mix(aSwarm,aTrace,fw);

  // The visitor's pointer pushes particles aside, within 140 px.
  vec2 d=pos-uPointer.xy; float r=length(d);
  float push=uPointer.z*pow(max(0.0,1.0-r/140.0),2.0);
  if(r>0.001) acc+=d/r*push*1800.0;

  vel+=acc*uDt;
  // Activation: ink where the recording spikes or the pointer touched, tissue at rest.
  float act=max(fw*smoothstep(0.15,0.8,abs(s)), push);
  float z=mix(V.z,act,1.0-exp(-uDt*6.0));
  // Arrived: latches once a particle reaches its point, so it then rides the playing trace
  // exactly; it clears as soon as the particle is released.
  // w > 0: arrived on its shape point (latched, ramps to 1). w < 0: just released, counting up
  // from -1 to 0 over about 0.9 s (the burst above).
  float arrived;
  if(fw>0.85) arrived=(dist<10.0 || V.w>0.0) ? min(1.0,max(V.w,0.0)+uDt*4.0) : 0.0;
  else arrived=V.w>0.5 ? -1.0 : min(0.0,V.w+uDt/0.9);
  if(uSnap>0.5){ vel=vec2(0.0); z=0.0; arrived=0.0; }
  gl_FragColor=vec4(vel,z,arrived);
}
`;

export const positionShader = /* glsl */ `
${common}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 P=texture2D(texPos,uv); vec4 V=texture2D(texVel,uv); vec4 H=texture2D(uHome,uv);
  vec2 pos=P.xy+V.xy*uDt;
  float fw=formWeight(H,P.w,uForm);
  // Swarm particles move rigidly with their parallax homes, so scrolling never stretches them.
  pos.y-=uScrollDy*0.3*(1.0-fw);
  if(fw<0.5){
    float span=uViewport.y+2.0*WRAP_M;
    // Keep each particle within half a band of its home: one wrap, never a band that hops every frame.
    float hy=swarmHome(H).y;
    pos.y=hy+mod(pos.y-hy+0.5*span,span)-0.5*span;
  }
  // Once the trace formation has settled, lock particles to the line: no spring lag while it plays.
  float s, depth; vec2 target=heroTarget(H,P.w,uv,s,depth);
  // Lock onto the line only once arrived, so re-forming is a swim, never a jump.
  float lock=smoothstep(0.85,1.0,fw)*max(V.w,1.0-smoothstep(3.0,24.0,length(target-pos)));
  if(lock>0.0) pos=mix(pos,target,lock);
  if(uSnap>0.5) pos=swarmHome(H);
  // z carries the hand's depth to the point shader (near dots larger and darker).
  gl_FragColor=vec4(pos,depth*fw,P.w);
}
`;

export const pointsVertex = /* glsl */ `
uniform sampler2D texPos;
uniform sampler2D texVel;
uniform sampler2D uHome;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uForm;
uniform float uHandOn;
const float HAND_SPLIT=0.6;
attribute vec2 ref;
varying float vAct;
varying vec2 vScreen;
varying float vRank;
varying float vSeed;
varying float vRecruit;
varying float vDepth;
bool isHand(vec4 h){ return uHandOn>0.5 && h.w>HAND_SPLIT; }
float traceU(vec4 h){ return uHandOn>0.5 ? h.w/HAND_SPLIT : h.w; }
float formWeight(vec4 h, float seed, float form){
  float st=isHand(h) ? 0.78+0.2*fract(seed*7.31) : traceU(h)*0.72+0.06*fract(seed*3.7);
  float f=clamp((form-st*0.7)/0.3,0.0,1.0);
  return f*f*(3.0-2.0*f);
}
void main(){
  vec4 P=texture2D(texPos,ref); vec4 V=texture2D(texVel,ref); vec4 H=texture2D(uHome,ref);
  vec2 ndc=vec2(P.x/uViewport.x*2.0-1.0, 1.0-P.y/uViewport.y*2.0);
  gl_Position=vec4(ndc,0.0,1.0);
  vAct=V.z; vRank=H.z; vScreen=P.xy/uViewport; vSeed=P.w; vDepth=P.z;
  vRecruit=formWeight(H,P.w,uForm);
  // Swarm dots 1.4-2.5 px; recruited dots swell a little; on the hand, nearer dots are larger.
  gl_PointSize=(mix(1.4,2.5,H.z*H.z)+vRecruit*0.9)*(1.0+0.25*P.z)*uPixelRatio;
}
`;

export const pointsFragment = /* glsl */ `
uniform vec3 uTissue;
uniform vec3 uInk;
uniform vec3 uInkDim;
uniform vec3 uDrift;
uniform float uBleed;      // 0 clean ink .. 1 bled into drift blue
uniform float uForm;       // 0 swarm .. 1 trace
uniform sampler2D uMask;   // 1 where text sits, blurred
uniform float uFade;       // global fade-in, 0..1
uniform float uMaskStrength;
varying float vAct;
varying vec2 vScreen;
varying float vRank;
varying float vSeed;
varying float vRecruit;
varying float vDepth;
float hash(float n){ return fract(sin(n)*43758.5453); }
void main(){
  vec2 c=gl_PointCoord-0.5; float r2=dot(c,c);
  // Ink dot: the edge wobbles with angle, seeded per particle, like a nib touching damp paper.
  float ang=atan(c.y,c.x);
  float wob=0.9+0.1*sin(ang*3.0+vSeed*40.0)*hash(vSeed*7.1)+0.06*sin(ang*5.0+vSeed*91.0);
  float rr=0.25*wob*wob;
  if(r2>rr) discard;
  float edge=smoothstep(rr,rr*0.45,r2);

  // Recruitment by darkness: resting dots are tissue, joining the trace stains them ink,
  // and spikes in the recording (or the visitor's pointer) push them darker still.
  float recruit=clamp(max(vRecruit,vAct),0.0,1.0);
  vec3 rest=mix(uTissue,uInkDim,0.3+0.35*vRank*vRank);
  vec3 col=mix(rest,uInk,recruit);
  col=mix(col,uDrift,uBleed*recruit);
  float a=mix(mix(0.75,0.95,vRank), mix(0.8,0.95,vAct), recruit);
  // Far side of the hand is paler, so it reads as a solid turning in space.
  a*=clamp(0.78+0.45*vDepth,0.4,1.0);

  float mask=texture2D(uMask,vec2(vScreen.x,1.0-vScreen.y)).r;
  a*=edge*(1.0-uMaskStrength*mask)*uFade;
  gl_FragColor=vec4(col*a,a);
}
`;
