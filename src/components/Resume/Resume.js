import React, { useState, useEffect } from "react";
import { Container, Row, Col } from "react-bootstrap";
import Button from "react-bootstrap/Button";
import Particle from "../Particle";
import Resumecontent from "./ResumeContent";
import "../../style.css";
import "bootstrap/dist/css/bootstrap.min.css";
import axios from "axios";
import pdf from "../../Assets/resume_web_jan_21.pdf";

function Resume() {
  const uri = "https://porfolio-backend.vercel.app/ranks/getRanks";
  const [spojRank, upadteSpojRank] = useState(0);
  const [hackerrank, upadteHackerank] = useState(0);
  const [sem, upadateSem] = useState(0);
  const [cgpa, upadteCgpa] = useState(0);

  useEffect(() => {
    axios
      .get(uri)
      .then((res) => {
        upadteSpojRank(res.data.message[0].spojRank);
        upadteHackerank(res.data.message[1].hackerrank);
        upadteCgpa(res.data.message[2].cgpa);
        upadateSem(res.data.message[3].sem);
      })
      .catch((err) => {
        console.log(err);
      });
  }, []);

  return (
    <Container fluid className="resume-section">
      <Particle />
      <Container>
        <Row style={{ justifyContent: "center", position: "relative" }}>
          <Button variant="primary" href={pdf} target="_blank">
            <i className="fas fa-download">&nbsp;</i>Download CV
          </Button>
        </Row>
        <Row className="resume">
          <Col md={6} className="resume-left">
            <h3 className="resume-title">Experience</h3>
            <Resumecontent
              title="Teaching Assistant"
              company="Coding Blocks"
              date="November 2019 - April 2020"
              content={[
                "I used to tackle questions related to the understudies joined up with Machine Learning or DataScience batch",
              ]}
            />
            <Resumecontent
              title="Mentor"
              company="Google Code In - 19'"
              date="Jan 2020 - March 2020"
              content={[
                "The position involved mentoring the school going students (13-17) years of age to introduce them to open source and giving them the opportu-nity to become part of the open source community by working on real-world software projects, supported by an international community to help them learn and succeed"
              ]}
            />
            <Resumecontent
              title="Competitive Programming Head"
              company="Developer Students Club"
              date="Apr 2018 - Apr 2020"
              content={[
                `I worked in this association for a long time. In the principal year, I was
                an RNIS official, where I used to show understudies equipment and
                robots. Later I filled in as a serious Programming top of this general
                public, where we used to have programming challenges and hold work-
                shops on advanced programming.`
              ]}
            />
            
          </Col>
          <Col md={6} className="resume-right">
            <h3 className="resume-title">Education</h3>
            <Resumecontent
              title="Bachleors in Information Technology [BVCOE]"
          
              date="2017 - Present"
              content={[`CGPA: ${8.6} (Till ${6}th Sem)`]}
            />
            <Resumecontent
              title="12TH BOARD [ CBSE, MVN(faridabad) ]"
              date="2015 - 2017"
              content={["Precentage: 88%"]}
            />
            <h3 className="resume-title">Ranks and Achivements</h3>
            <Resumecontent
              title=""
              content={[
                `3 ★ @ CodeChef`,
                `First Prize in IDEAHACK
                 HACKER-EARTH(BVP)`,
                `Secured 6th Rank in Programming Contest
                Nagarro and Coding Blocks`,
                `Second Prize in RoboSoccer(DU)`,
                `First Prize in RoboRugby AVENSIS (MSIT)`,
                `Second Prize in Technovate
                INNERVE(IGDTUW)`
              ]}
            />
          </Col>
        </Row>
        <Row style={{ justifyContent: "center", position: "relative" }}>
          <Button variant="primary" href={pdf} target="_blank">
            <i className="fas fa-download">&nbsp;</i>Download CV
          </Button>
        </Row>
      </Container>
    </Container>
  );
}

export default Resume;
